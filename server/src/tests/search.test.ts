import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, companiesTable, blacklistEntriesTable } from '../db/schema';
import { type SearchInput } from '../schema';
import { eq } from 'drizzle-orm';
import { 
  searchBlacklistEntries, 
  searchByText, 
  getSearchSuggestions 
} from '../handlers/search';

// Test data setup
let userCounter = 0;

const resetCounter = () => {
  userCounter = 0;
  entryCounter = 0;
};

const createTestUser = async (isAdmin: boolean = false) => {
  userCounter++;
  const result = await db.insert(usersTable)
    .values({
      email: isAdmin ? `admin${userCounter}@test.com` : `user${userCounter}@test.com`,
      password_hash: 'hashed_password',
      first_name: 'Test',
      last_name: isAdmin ? 'Admin' : 'User',
      phone: `123456789${userCounter}`,
      is_admin: isAdmin,
      is_active: true,
      two_fa_enabled: false
    })
    .returning()
    .execute();
  return result[0];
};

const createTestCompany = async (userId: number, name: string = 'Test Company') => {
  const result = await db.insert(companiesTable)
    .values({
      user_id: userId,
      name,
      legal_representative_name: 'Test Representative',
      phone: '0987654321',
      address: '123 Test St',
      city: 'Test City'
    })
    .returning()
    .execute();
  return result[0];
};

let entryCounter = 0;

const createTestBlacklistEntry = async (userId: number, companyId: number, overrides: Partial<any> = {}) => {
  entryCounter++;
  const result = await db.insert(blacklistEntriesTable)
    .values({
      user_id: userId,
      company_id: companyId,
      first_name: `DefaultFirst${entryCounter}`,
      last_name: `DefaultLast${entryCounter}`,
      id_number: `DEFAULT${entryCounter}${entryCounter}${entryCounter}${entryCounter}${entryCounter}${entryCounter}${entryCounter}${entryCounter}${entryCounter}${entryCounter}${entryCounter}`,
      phone: `555000${entryCounter.toString().padStart(4, '0')}`,
      email: `default${entryCounter}@example.com`,
      reason: 'Test reason',
      blacklist_score: 75,
      status: 'active',
      is_blacklisted: true,
      ...overrides
    })
    .returning()
    .execute();
  return result[0];
};

describe('searchBlacklistEntries', () => {
  beforeEach(async () => {
    resetCounter();
    await createDB();
  });
  afterEach(resetDB);

  it('should search entries for regular user', async () => {
    // Create test data
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    // Create multiple entries with unique names to avoid conflicts
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Alexander',
      last_name: 'Smith',
      id_number: '11111111111',
      email: 'alexander.smith@test.com'
    });
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Jane',
      last_name: 'Doe',
      id_number: '22222222222',
      email: 'jane.doe@test.com'
    });

    const searchInput: SearchInput = {
      query: 'Alexander',
      limit: 20,
      offset: 0
    };

    const result = await searchBlacklistEntries(user.id, searchInput);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].first_name).toBe('Alexander');
    expect(result.entries[0].last_name).toBe('Smith');
    expect(result.total).toBe(1);
    expect(result.face_matches).toBeUndefined();
  });

  it('should search entries with face image input', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'FaceTest',
      last_name: 'User',
      id_number: 'FACE123456789'
    });

    const searchInput: SearchInput = {
      face_image: 'base64encodedimage',
      limit: 20,
      offset: 0
    };

    const result = await searchBlacklistEntries(user.id, searchInput);

    expect(result.entries).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.face_matches).toEqual([]);
  });

  it('should filter by status', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    await createTestBlacklistEntry(user.id, company.id, { status: 'active' });
    await createTestBlacklistEntry(user.id, company.id, { status: 'inactive' });
    await createTestBlacklistEntry(user.id, company.id, { status: 'pending' });

    const searchInput: SearchInput = {
      status: 'active',
      limit: 20,
      offset: 0
    };

    const result = await searchBlacklistEntries(user.id, searchInput);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].status).toBe('active');
    expect(result.total).toBe(1);
  });

  it('should search across multiple fields', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Alice',
      last_name: 'Johnson',
      email: 'alice.johnson@test.com',
      phone: '5559876543',
      id_number: '99999999999'
    });

    // Test search by first name
    let result = await searchBlacklistEntries(user.id, { query: 'Alice', limit: 20, offset: 0 });
    expect(result.entries).toHaveLength(1);

    // Test search by email
    result = await searchBlacklistEntries(user.id, { query: 'alice.johnson', limit: 20, offset: 0 });
    expect(result.entries).toHaveLength(1);

    // Test search by phone
    result = await searchBlacklistEntries(user.id, { query: '5559876543', limit: 20, offset: 0 });
    expect(result.entries).toHaveLength(1);

    // Test search by ID number
    result = await searchBlacklistEntries(user.id, { query: '99999999999', limit: 20, offset: 0 });
    expect(result.entries).toHaveLength(1);
  });

  it('should apply pagination', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    // Create 3 entries
    for (let i = 1; i <= 3; i++) {
      await createTestBlacklistEntry(user.id, company.id, {
        first_name: `User${i}`,
        id_number: `${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`
      });
    }

    // Test first page
    let result = await searchBlacklistEntries(user.id, { limit: 2, offset: 0 });
    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(3);

    // Test second page
    result = await searchBlacklistEntries(user.id, { limit: 2, offset: 2 });
    expect(result.entries).toHaveLength(1);
    expect(result.total).toBe(3);
  });

  it('should allow admin to search across all companies', async () => {
    const admin = await createTestUser(true);
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    
    const company1 = await createTestCompany(user1.id, 'Company 1');
    const company2 = await createTestCompany(user2.id, 'Company 2');
    
    await createTestBlacklistEntry(user1.id, company1.id, { first_name: 'Company1User' });
    await createTestBlacklistEntry(user2.id, company2.id, { first_name: 'Company2User' });

    const result = await searchBlacklistEntries(admin.id, { limit: 20, offset: 0 });

    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('should allow admin to filter by specific company', async () => {
    const admin = await createTestUser(true);
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    
    const company1 = await createTestCompany(user1.id, 'Company 1');
    const company2 = await createTestCompany(user2.id, 'Company 2');
    
    await createTestBlacklistEntry(user1.id, company1.id, { first_name: 'Company1User' });
    await createTestBlacklistEntry(user2.id, company2.id, { first_name: 'Company2User' });

    const result = await searchBlacklistEntries(admin.id, {
      company_id: company1.id,
      limit: 20,
      offset: 0
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].first_name).toBe('Company1User');
    expect(result.total).toBe(1);
  });

  it('should throw error for non-existent user', async () => {
    const searchInput: SearchInput = { limit: 20, offset: 0 };

    expect(searchBlacklistEntries(999, searchInput)).rejects.toThrow(/User not found/i);
  });

  it('should throw error for user without company', async () => {
    const user = await createTestUser();
    const searchInput: SearchInput = { limit: 20, offset: 0 };

    expect(searchBlacklistEntries(user.id, searchInput)).rejects.toThrow(/User has no associated company/i);
  });
});

describe('searchByText', () => {
  beforeEach(async () => {
    resetCounter();
    await createDB();
  });
  afterEach(resetDB);

  it('should search by text query', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Michael',
      last_name: 'Johnson'
    });
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Sarah',
      last_name: 'Williams'
    });

    const result = await searchByText('Michael');

    expect(result).toHaveLength(1);
    expect(result[0].first_name).toBe('Michael');
  });

  it('should filter by company when provided', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    
    const company1 = await createTestCompany(user1.id, 'Company 1');
    const company2 = await createTestCompany(user2.id, 'Company 2');
    
    await createTestBlacklistEntry(user1.id, company1.id, { first_name: 'Test' });
    await createTestBlacklistEntry(user2.id, company2.id, { first_name: 'Test' });

    const result = await searchByText('Test', company1.id);

    expect(result).toHaveLength(1);
    expect(result[0].company_id).toBe(company1.id);
  });

  it('should return empty array for empty query', async () => {
    const result = await searchByText('');
    expect(result).toHaveLength(0);
  });

  it('should return empty array for whitespace query', async () => {
    const result = await searchByText('   ');
    expect(result).toHaveLength(0);
  });
});

describe('getSearchSuggestions', () => {
  beforeEach(async () => {
    resetCounter();
    await createDB();
  });
  afterEach(resetDB);

  it('should return search suggestions', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Alexander',
      last_name: 'Smith',
      email: 'alex.smith@example.com',
      phone: '5551234567',
      id_number: 'ID123456789'
    });

    const result = await getSearchSuggestions(user.id, 'Alex');

    expect(result.length).toBeGreaterThan(0);
    
    // Should find name suggestion
    const nameSuggestion = result.find(s => s.type === 'name');
    expect(nameSuggestion).toBeDefined();
    expect(nameSuggestion?.value).toBe('Alexander Smith');
    
    // Should find email suggestion
    const emailSuggestion = result.find(s => s.type === 'email');
    expect(emailSuggestion).toBeDefined();
    expect(emailSuggestion?.value).toBe('alex.smith@example.com');
  });

  it('should return suggestions by ID number', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Test',
      last_name: 'User',
      id_number: 'ABC123XYZ'
    });

    const result = await getSearchSuggestions(user.id, 'ABC');

    expect(result.length).toBeGreaterThan(0);
    const idSuggestion = result.find(s => s.type === 'id_number');
    expect(idSuggestion).toBeDefined();
    expect(idSuggestion?.value).toBe('ABC123XYZ');
  });

  it('should return suggestions by phone', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Test',
      last_name: 'User',
      phone: '5559876543'
    });

    const result = await getSearchSuggestions(user.id, '555987');

    expect(result.length).toBeGreaterThan(0);
    const phoneSuggestion = result.find(s => s.type === 'phone');
    expect(phoneSuggestion).toBeDefined();
    expect(phoneSuggestion?.value).toBe('5559876543');
  });

  it('should limit suggestions to prevent overwhelming UI', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    // Create many entries with similar names
    for (let i = 0; i < 20; i++) {
      await createTestBlacklistEntry(user.id, company.id, {
        first_name: `Test${i}`,
        last_name: 'User',
        id_number: `ID${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`
      });
    }

    const result = await getSearchSuggestions(user.id, 'Test');

    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('should return empty array for short query', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    await createTestBlacklistEntry(user.id, company.id);

    let result = await getSearchSuggestions(user.id, 'A');
    expect(result).toHaveLength(0);

    result = await getSearchSuggestions(user.id, '');
    expect(result).toHaveLength(0);
  });

  it('should return empty array for user without company', async () => {
    const user = await createTestUser();

    const result = await getSearchSuggestions(user.id, 'Test');
    expect(result).toHaveLength(0);
  });

  it('should return empty array for non-existent user', async () => {
    const result = await getSearchSuggestions(999, 'Test');
    expect(result).toHaveLength(0);
  });

  it('should remove duplicate suggestions', async () => {
    const user = await createTestUser();
    const company = await createTestCompany(user.id);
    
    // Create entries with similar data
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Duplicate',
      last_name: 'User',
      email: 'duplicate@example.com'
    });
    await createTestBlacklistEntry(user.id, company.id, {
      first_name: 'Duplicate',
      last_name: 'User',
      email: 'duplicate@example.com'
    });

    const result = await getSearchSuggestions(user.id, 'duplicate');

    // Count occurrences of each suggestion
    const nameSuggestions = result.filter(s => s.type === 'name' && s.value === 'Duplicate User');
    const emailSuggestions = result.filter(s => s.type === 'email' && s.value === 'duplicate@example.com');

    expect(nameSuggestions).toHaveLength(1);
    expect(emailSuggestions).toHaveLength(1);
  });
});