import { db } from '../db';
import { 
  blacklistEntriesTable, 
  companiesTable, 
  activityLogsTable 
} from '../db/schema';
import { 
  type CreateBlacklistEntry, 
  type UpdateBlacklistEntry, 
  type BlacklistEntry,
  type BlacklistFilter,
  type Pagination
} from '../schema';
import { eq, and, or, like, gte, lte, between, count, SQL, desc } from 'drizzle-orm';

// Helper function to calculate blacklist score based on reason and other factors
function calculateBlacklistScore(reason: string, hasDocuments: boolean, hasFaceImage: boolean): number {
  let baseScore = 50;
  
  // Increase score based on reason severity
  const highRiskKeywords = ['fraud', 'theft', 'violence', 'criminal', 'scam'];
  const mediumRiskKeywords = ['dispute', 'complaint', 'unpaid', 'breach'];
  
  const reasonLower = reason.toLowerCase();
  if (highRiskKeywords.some(keyword => reasonLower.includes(keyword))) {
    baseScore += 30;
  } else if (mediumRiskKeywords.some(keyword => reasonLower.includes(keyword))) {
    baseScore += 15;
  }
  
  // Increase score if documentation is provided
  if (hasDocuments) baseScore += 10;
  if (hasFaceImage) baseScore += 10;
  
  // Cap at 100
  return Math.min(baseScore, 100);
}

// Helper function to get user's company ID
async function getUserCompanyId(userId: number): Promise<number> {
  try {
    const company = await db.select()
      .from(companiesTable)
      .where(eq(companiesTable.user_id, userId))
      .execute();
    
    if (!company.length) {
      throw new Error(`User company not found for user ID: ${userId}`);
    }
    
    return company[0].id;
  } catch (error) {
    console.error('Failed to get user company ID:', error);
    throw error;
  }
}

// Helper function to log activity
async function logActivity(
  userId: number, 
  action: string, 
  resourceId?: number, 
  details?: string
): Promise<void> {
  try {
    await db.insert(activityLogsTable)
      .values({
        user_id: userId,
        action,
        resource_type: 'blacklist_entry',
        resource_id: resourceId,
        details,
        ip_address: null,
        user_agent: null
      })
      .execute();
  } catch (error) {
    console.error('Failed to log activity:', error);
    // Don't throw - activity logging shouldn't break the main operation
  }
}

export async function createBlacklistEntry(userId: number, input: CreateBlacklistEntry): Promise<BlacklistEntry> {
  try {
    // Get user's company ID
    const companyId = await getUserCompanyId(userId);
    
    // Calculate blacklist score
    const blacklistScore = calculateBlacklistScore(
      input.reason,
      input.id_document_urls.length > 0,
      Boolean(input.face_image_url)
    );
    
    // Create new blacklist entry
    const result = await db.insert(blacklistEntriesTable)
      .values({
        user_id: userId,
        company_id: companyId,
        first_name: input.first_name,
        last_name: input.last_name,
        id_number: input.id_number,
        phone: input.phone,
        email: input.email,
        face_image_url: input.face_image_url,
        id_document_urls: input.id_document_urls,
        blacklist_score: blacklistScore,
        reason: input.reason,
        status: 'active',
        is_blacklisted: input.is_blacklisted
      })
      .returning()
      .execute();
    
    const entry = result[0];
    
    // Log the creation activity
    await logActivity(
      userId, 
      'created', 
      entry.id, 
      `Created blacklist entry for ${input.first_name} ${input.last_name}`
    );
    
    return entry;
  } catch (error) {
    console.error('Blacklist entry creation failed:', error);
    throw error;
  }
}

export async function getBlacklistEntries(
  userId: number, 
  filters: BlacklistFilter, 
  pagination: Pagination
): Promise<{ entries: BlacklistEntry[]; total: number }> {
  try {
    // Get user's company ID
    const companyId = await getUserCompanyId(userId);
    
    // Build conditions array
    const conditions: SQL<unknown>[] = [
      eq(blacklistEntriesTable.company_id, companyId)
    ];
    
    // Apply filters
    if (filters.status) {
      conditions.push(eq(blacklistEntriesTable.status, filters.status));
    }
    
    if (filters.search) {
      const searchPattern = `%${filters.search}%`;
      conditions.push(
        or(
          like(blacklistEntriesTable.first_name, searchPattern),
          like(blacklistEntriesTable.last_name, searchPattern),
          like(blacklistEntriesTable.id_number, searchPattern),
          like(blacklistEntriesTable.email, searchPattern),
          like(blacklistEntriesTable.reason, searchPattern)
        )!
      );
    }
    
    if (filters.date_from && filters.date_to) {
      conditions.push(between(blacklistEntriesTable.created_at, filters.date_from, filters.date_to));
    } else if (filters.date_from) {
      conditions.push(gte(blacklistEntriesTable.created_at, filters.date_from));
    } else if (filters.date_to) {
      conditions.push(lte(blacklistEntriesTable.created_at, filters.date_to));
    }
    
    if (filters.min_score !== undefined) {
      conditions.push(gte(blacklistEntriesTable.blacklist_score, filters.min_score));
    }
    
    if (filters.max_score !== undefined) {
      conditions.push(lte(blacklistEntriesTable.blacklist_score, filters.max_score));
    }
    
    // Build where condition
    const whereCondition = conditions.length === 1 ? conditions[0] : and(...conditions);
    
    // Build queries step by step to avoid type issues
    const baseQuery = db.select().from(blacklistEntriesTable);
    const baseCountQuery = db.select({ count: count() }).from(blacklistEntriesTable);
    
    const filteredQuery = baseQuery.where(whereCondition);
    const filteredCountQuery = baseCountQuery.where(whereCondition);
    
    // Apply ordering and pagination
    const finalQuery = filteredQuery
      .orderBy(desc(blacklistEntriesTable.created_at))
      .limit(pagination.limit)
      .offset((pagination.page - 1) * pagination.limit);
    
    // Execute queries
    const [entries, totalResult] = await Promise.all([
      finalQuery.execute(),
      filteredCountQuery.execute()
    ]);
    
    return {
      entries,
      total: totalResult[0].count
    };
  } catch (error) {
    console.error('Failed to get blacklist entries:', error);
    throw error;
  }
}

export async function getBlacklistEntry(userId: number, entryId: number): Promise<BlacklistEntry | null> {
  try {
    // Get user's company ID
    const companyId = await getUserCompanyId(userId);
    
    // Find entry by ID and company ID (security check)
    const results = await db.select()
      .from(blacklistEntriesTable)
      .where(
        and(
          eq(blacklistEntriesTable.id, entryId),
          eq(blacklistEntriesTable.company_id, companyId)
        )
      )
      .execute();
    
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('Failed to get blacklist entry:', error);
    throw error;
  }
}

export async function updateBlacklistEntry(userId: number, input: UpdateBlacklistEntry): Promise<BlacklistEntry> {
  try {
    // Get user's company ID
    const companyId = await getUserCompanyId(userId);
    
    // Verify entry belongs to user's company
    const existingEntry = await getBlacklistEntry(userId, input.id);
    if (!existingEntry) {
      throw new Error('Blacklist entry not found or access denied');
    }
    
    // Prepare update data
    const updateData: any = {
      updated_at: new Date()
    };
    
    // Add provided fields to update
    if (input.first_name !== undefined) updateData.first_name = input.first_name;
    if (input.last_name !== undefined) updateData.last_name = input.last_name;
    if (input.id_number !== undefined) updateData.id_number = input.id_number;
    if (input.phone !== undefined) updateData.phone = input.phone;
    if (input.email !== undefined) updateData.email = input.email;
    if (input.face_image_url !== undefined) updateData.face_image_url = input.face_image_url;
    if (input.id_document_urls !== undefined) updateData.id_document_urls = input.id_document_urls;
    if (input.reason !== undefined) updateData.reason = input.reason;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.is_blacklisted !== undefined) updateData.is_blacklisted = input.is_blacklisted;
    
    // Recalculate blacklist score if reason or documents changed
    if (input.reason !== undefined || input.id_document_urls !== undefined || input.face_image_url !== undefined) {
      const reason = input.reason ?? existingEntry.reason;
      const documentUrls = input.id_document_urls ?? existingEntry.id_document_urls;
      const faceImageUrl = input.face_image_url ?? existingEntry.face_image_url;
      
      updateData.blacklist_score = calculateBlacklistScore(
        reason,
        documentUrls.length > 0,
        Boolean(faceImageUrl)
      );
    }
    
    // Update entry
    const result = await db.update(blacklistEntriesTable)
      .set(updateData)
      .where(
        and(
          eq(blacklistEntriesTable.id, input.id),
          eq(blacklistEntriesTable.company_id, companyId)
        )
      )
      .returning()
      .execute();
    
    if (!result.length) {
      throw new Error('Failed to update blacklist entry');
    }
    
    const updatedEntry = result[0];
    
    // Log the update activity
    await logActivity(
      userId, 
      'updated', 
      input.id, 
      `Updated blacklist entry for ${updatedEntry.first_name} ${updatedEntry.last_name}`
    );
    
    return updatedEntry;
  } catch (error) {
    console.error('Failed to update blacklist entry:', error);
    throw error;
  }
}

export async function deleteBlacklistEntry(userId: number, entryId: number): Promise<{ success: boolean }> {
  try {
    // Get user's company ID
    const companyId = await getUserCompanyId(userId);
    
    // Verify entry belongs to user's company
    const existingEntry = await getBlacklistEntry(userId, entryId);
    if (!existingEntry) {
      throw new Error('Blacklist entry not found or access denied');
    }
    
    // Delete entry from database
    const result = await db.delete(blacklistEntriesTable)
      .where(
        and(
          eq(blacklistEntriesTable.id, entryId),
          eq(blacklistEntriesTable.company_id, companyId)
        )
      )
      .execute();
    
    // Log the deletion activity
    await logActivity(
      userId, 
      'deleted', 
      entryId, 
      `Deleted blacklist entry for ${existingEntry.first_name} ${existingEntry.last_name}`
    );
    
    return { success: true };
  } catch (error) {
    console.error('Failed to delete blacklist entry:', error);
    throw error;
  }
}

export async function toggleBlacklistStatus(userId: number, entryId: number, isBlacklisted: boolean): Promise<BlacklistEntry> {
  try {
    // Get user's company ID
    const companyId = await getUserCompanyId(userId);
    
    // Verify entry belongs to user's company
    const existingEntry = await getBlacklistEntry(userId, entryId);
    if (!existingEntry) {
      throw new Error('Blacklist entry not found or access denied');
    }
    
    // Update is_blacklisted status and related status
    const newStatus = isBlacklisted ? 'active' : 'inactive';
    
    const result = await db.update(blacklistEntriesTable)
      .set({
        is_blacklisted: isBlacklisted,
        status: newStatus,
        updated_at: new Date()
      })
      .where(
        and(
          eq(blacklistEntriesTable.id, entryId),
          eq(blacklistEntriesTable.company_id, companyId)
        )
      )
      .returning()
      .execute();
    
    if (!result.length) {
      throw new Error('Failed to toggle blacklist status');
    }
    
    const updatedEntry = result[0];
    
    // Log the status change activity
    await logActivity(
      userId, 
      isBlacklisted ? 'blacklisted' : 'unblacklisted', 
      entryId, 
      `${isBlacklisted ? 'Blacklisted' : 'Unblacklisted'} ${updatedEntry.first_name} ${updatedEntry.last_name}`
    );
    
    return updatedEntry;
  } catch (error) {
    console.error('Failed to toggle blacklist status:', error);
    throw error;
  }
}