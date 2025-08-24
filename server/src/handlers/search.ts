import { db } from '../db';
import { blacklistEntriesTable, usersTable, companiesTable } from '../db/schema';
import { type SearchInput, type BlacklistEntry } from '../schema';
import { eq, and, or, ilike, count, SQL } from 'drizzle-orm';

export async function searchBlacklistEntries(userId: number, input: SearchInput): Promise<{
  entries: BlacklistEntry[];
  total: number;
  face_matches?: Array<{ entry_id: number; confidence: number }>;
}> {
  try {
    // Get user's company ID or determine if admin
    const userResult = await db.select({
      is_admin: usersTable.is_admin,
      company_id: companiesTable.id
    })
      .from(usersTable)
      .leftJoin(companiesTable, eq(companiesTable.user_id, usersTable.id))
      .where(eq(usersTable.id, userId))
      .execute();

    if (!userResult.length) {
      throw new Error('User not found');
    }

    const user = userResult[0];
    const isAdmin = user.is_admin;
    const userCompanyId = user.company_id;

    // Build conditions array
    const conditions: SQL<unknown>[] = [];

    // Apply company filter - non-admin users can only see their company's entries
    if (!isAdmin) {
      if (!userCompanyId) {
        throw new Error('User has no associated company');
      }
      conditions.push(eq(blacklistEntriesTable.company_id, userCompanyId));
    } else if (input.company_id) {
      // Admin can filter by specific company
      conditions.push(eq(blacklistEntriesTable.company_id, input.company_id));
    }

    // Apply status filter
    if (input.status) {
      conditions.push(eq(blacklistEntriesTable.status, input.status));
    }

    // Apply text search across multiple fields
    if (input.query && input.query.trim().length > 0) {
      const searchTerm = `%${input.query.trim()}%`;
      conditions.push(
        or(
          ilike(blacklistEntriesTable.first_name, searchTerm),
          ilike(blacklistEntriesTable.last_name, searchTerm),
          ilike(blacklistEntriesTable.id_number, searchTerm),
          ilike(blacklistEntriesTable.email, searchTerm),
          ilike(blacklistEntriesTable.phone, searchTerm)
        )!
      );
    }

    // Execute queries based on conditions
    const [entries, totalResult] = await Promise.all([
      // Entries query
      conditions.length === 0
        ? db.select().from(blacklistEntriesTable).limit(input.limit).offset(input.offset).execute()
        : db.select().from(blacklistEntriesTable)
            .where(conditions.length === 1 ? conditions[0] : and(...conditions))
            .limit(input.limit).offset(input.offset).execute(),
      
      // Count query  
      conditions.length === 0
        ? db.select({ count: count() }).from(blacklistEntriesTable).execute()
        : db.select({ count: count() }).from(blacklistEntriesTable)
            .where(conditions.length === 1 ? conditions[0] : and(...conditions))
            .execute()
    ]);

    const total = totalResult[0]?.count || 0;

    // Handle face image search if provided
    let faceMatches: Array<{ entry_id: number; confidence: number }> | undefined;
    if (input.face_image) {
      // For now, return empty face matches as AWS Rekognition integration would be required
      // In a real implementation, this would:
      // 1. Decode the base64 image
      // 2. Call AWS Rekognition to detect faces
      // 3. Compare against stored face images
      // 4. Return matches with confidence scores
      faceMatches = [];
    }

    return {
      entries,
      total: typeof total === 'number' ? total : 0,
      face_matches: faceMatches
    };
  } catch (error) {
    console.error('Search blacklist entries failed:', error);
    throw error;
  }
}

export async function searchByFaceImage(faceImageBase64: string): Promise<Array<{
  entry: BlacklistEntry;
  confidence: number;
}>> {
  try {
    // This is a placeholder implementation for face recognition search
    // In a real implementation, this would:
    // 1. Validate base64 image format
    // 2. Decode base64 to binary data
    // 3. Call AWS Rekognition SearchFacesByImage API
    // 4. Compare against stored face images in the collection
    // 5. Return matching entries with confidence scores sorted by confidence

    // For now, return empty results
    return [];
  } catch (error) {
    console.error('Face image search failed:', error);
    throw error;
  }
}

export async function searchByText(query: string, companyId?: number): Promise<BlacklistEntry[]> {
  try {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchTerm = `%${query.trim()}%`;
    const conditions: SQL<unknown>[] = [];

    // Add text search condition
    conditions.push(
      or(
        ilike(blacklistEntriesTable.first_name, searchTerm),
        ilike(blacklistEntriesTable.last_name, searchTerm),
        ilike(blacklistEntriesTable.id_number, searchTerm),
        ilike(blacklistEntriesTable.email, searchTerm),
        ilike(blacklistEntriesTable.phone, searchTerm)
      )!
    );

    // Add company filter if provided
    if (companyId) {
      conditions.push(eq(blacklistEntriesTable.company_id, companyId));
    }

    // Execute query based on conditions
    const results = conditions.length === 1 
      ? await db.select().from(blacklistEntriesTable).where(conditions[0]).execute()
      : await db.select().from(blacklistEntriesTable).where(and(...conditions)).execute();

    return results;
  } catch (error) {
    console.error('Text search failed:', error);
    throw error;
  }
}

export async function getSearchSuggestions(userId: number, query: string): Promise<Array<{
  type: 'name' | 'id_number' | 'email' | 'phone';
  value: string;
  entry_id: number;
}>> {
  try {
    if (!query || query.trim().length < 2) {
      return [];
    }

    // Get user's company ID
    const userResult = await db.select({
      is_admin: usersTable.is_admin,
      company_id: companiesTable.id
    })
      .from(usersTable)
      .leftJoin(companiesTable, eq(companiesTable.user_id, usersTable.id))
      .where(eq(usersTable.id, userId))
      .execute();

    if (!userResult.length) {
      return [];
    }

    const user = userResult[0];
    const isAdmin = user.is_admin;
    const userCompanyId = user.company_id;

    const searchTerm = `%${query.trim()}%`;
    const conditions: SQL<unknown>[] = [];

    // Apply company filter for non-admin users
    if (!isAdmin) {
      if (!userCompanyId) {
        return [];
      }
      conditions.push(eq(blacklistEntriesTable.company_id, userCompanyId));
    }

    // Add search conditions
    conditions.push(
      or(
        ilike(blacklistEntriesTable.first_name, searchTerm),
        ilike(blacklistEntriesTable.last_name, searchTerm),
        ilike(blacklistEntriesTable.id_number, searchTerm),
        ilike(blacklistEntriesTable.email, searchTerm),
        ilike(blacklistEntriesTable.phone, searchTerm)
      )!
    );

    // Execute query based on conditions
    const results = conditions.length === 1
      ? await db.select({
          id: blacklistEntriesTable.id,
          first_name: blacklistEntriesTable.first_name,
          last_name: blacklistEntriesTable.last_name,
          id_number: blacklistEntriesTable.id_number,
          email: blacklistEntriesTable.email,
          phone: blacklistEntriesTable.phone
        }).from(blacklistEntriesTable).where(conditions[0]).limit(10).execute()
      : await db.select({
          id: blacklistEntriesTable.id,
          first_name: blacklistEntriesTable.first_name,
          last_name: blacklistEntriesTable.last_name,
          id_number: blacklistEntriesTable.id_number,
          email: blacklistEntriesTable.email,
          phone: blacklistEntriesTable.phone
        }).from(blacklistEntriesTable).where(and(...conditions)).limit(10).execute();

    // Build suggestions array
    const suggestions: Array<{
      type: 'name' | 'id_number' | 'email' | 'phone';
      value: string;
      entry_id: number;
    }> = [];

    results.forEach(entry => {
      const fullName = `${entry.first_name} ${entry.last_name}`;
      
      // Add name suggestion if it matches
      if (fullName.toLowerCase().includes(query.toLowerCase())) {
        suggestions.push({
          type: 'name',
          value: fullName,
          entry_id: entry.id
        });
      }

      // Add ID number suggestion if it matches
      if (entry.id_number.toLowerCase().includes(query.toLowerCase())) {
        suggestions.push({
          type: 'id_number',
          value: entry.id_number,
          entry_id: entry.id
        });
      }

      // Add email suggestion if it matches and exists
      if (entry.email && entry.email.toLowerCase().includes(query.toLowerCase())) {
        suggestions.push({
          type: 'email',
          value: entry.email,
          entry_id: entry.id
        });
      }

      // Add phone suggestion if it matches and exists
      if (entry.phone && entry.phone.includes(query)) {
        suggestions.push({
          type: 'phone',
          value: entry.phone,
          entry_id: entry.id
        });
      }
    });

    // Remove duplicates and limit results
    const uniqueSuggestions = suggestions
      .filter((suggestion, index, self) => 
        index === self.findIndex(s => s.value === suggestion.value && s.type === suggestion.type)
      )
      .slice(0, 10);

    return uniqueSuggestions;
  } catch (error) {
    console.error('Get search suggestions failed:', error);
    throw error;
  }
}