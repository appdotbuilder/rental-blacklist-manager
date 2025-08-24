import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, companiesTable, blacklistEntriesTable, activityLogsTable } from '../db/schema';
import { 
  type CreateBlacklistEntry, 
  type UpdateBlacklistEntry,
  type BlacklistFilter,
  type Pagination 
} from '../schema';
import {
  createBlacklistEntry,
  getBlacklistEntries,
  getBlacklistEntry,
  updateBlacklistEntry,
  deleteBlacklistEntry,
  toggleBlacklistStatus
} from '../handlers/blacklist';
import { eq, and } from 'drizzle-orm';

// Test data
const testUser = {
  email: 'test@example.com',
  password_hash: 'hashed_password',
  first_name: 'John',
  last_name: 'Smith',
  phone: '1234567890',
  is_admin: false,
  is_active: true,
  two_fa_enabled: false
};

const testCompany = {
  user_id: 1, // Will be set after user creation
  name: 'Test Company',
  legal_representative_name: 'John Smith',
  phone: '1234567890',
  address: '123 Test St',
  city: 'Test City',
  association_membership: 'TEST123'
};

const testBlacklistEntry: CreateBlacklistEntry = {
  first_name: 'Jane',
  last_name: 'Doe',
  id_number: '123456789',
  phone: '0987654321',
  email: 'jane.doe@example.com',
  face_image_url: 'https://example.com/face.jpg',
  id_document_urls: ['https://example.com/id1.jpg', 'https://example.com/id2.jpg'],
  reason: 'Fraudulent activity detected',
  is_blacklisted: true
};

describe('blacklist handlers', () => {
  let userId: number;
  let companyId: number;

  beforeEach(async () => {
    await createDB();
    
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();
    userId = userResult[0].id;
    
    // Create test company
    const companyResult = await db.insert(companiesTable)
      .values({ ...testCompany, user_id: userId })
      .returning()
      .execute();
    companyId = companyResult[0].id;
  });

  afterEach(resetDB);

  describe('createBlacklistEntry', () => {
    it('should create a blacklist entry successfully', async () => {
      const result = await createBlacklistEntry(userId, testBlacklistEntry);

      expect(result.id).toBeDefined();
      expect(result.user_id).toBe(userId);
      expect(result.company_id).toBe(companyId);
      expect(result.first_name).toBe('Jane');
      expect(result.last_name).toBe('Doe');
      expect(result.id_number).toBe('123456789');
      expect(result.phone).toBe('0987654321');
      expect(result.email).toBe('jane.doe@example.com');
      expect(result.face_image_url).toBe('https://example.com/face.jpg');
      expect(result.id_document_urls).toEqual(['https://example.com/id1.jpg', 'https://example.com/id2.jpg']);
      expect(result.reason).toBe('Fraudulent activity detected');
      expect(result.status).toBe('active');
      expect(result.is_blacklisted).toBe(true);
      expect(result.blacklist_score).toBeGreaterThan(50); // Should be higher due to fraud keyword
      expect(result.created_at).toBeInstanceOf(Date);
      expect(result.updated_at).toBeInstanceOf(Date);
    });

    it('should calculate higher score for high-risk reasons', async () => {
      const highRiskEntry = {
        ...testBlacklistEntry,
        reason: 'Criminal fraud and theft activities'
      };

      const result = await createBlacklistEntry(userId, highRiskEntry);
      expect(result.blacklist_score).toBeGreaterThan(80);
    });

    it('should calculate lower score for medium-risk reasons', async () => {
      const mediumRiskEntry = {
        ...testBlacklistEntry,
        reason: 'Contract dispute and unpaid bills',
        face_image_url: null,
        id_document_urls: []
      };

      const result = await createBlacklistEntry(userId, mediumRiskEntry);
      expect(result.blacklist_score).toBeLessThan(80);
      expect(result.blacklist_score).toBeGreaterThan(50);
    });

    it('should save entry to database', async () => {
      const result = await createBlacklistEntry(userId, testBlacklistEntry);

      const savedEntries = await db.select()
        .from(blacklistEntriesTable)
        .where(eq(blacklistEntriesTable.id, result.id))
        .execute();

      expect(savedEntries).toHaveLength(1);
      expect(savedEntries[0].first_name).toBe('Jane');
      expect(savedEntries[0].company_id).toBe(companyId);
    });

    it('should log creation activity', async () => {
      const result = await createBlacklistEntry(userId, testBlacklistEntry);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(
          and(
            eq(activityLogsTable.user_id, userId),
            eq(activityLogsTable.action, 'created'),
            eq(activityLogsTable.resource_id, result.id)
          )
        )
        .execute();

      expect(activities).toHaveLength(1);
      expect(activities[0].resource_type).toBe('blacklist_entry');
    });

    it('should throw error if user company not found', async () => {
      const nonExistentUserId = 999;
      
      await expect(createBlacklistEntry(nonExistentUserId, testBlacklistEntry))
        .rejects.toThrow(/company not found/i);
    });
  });

  describe('getBlacklistEntries', () => {
    let entryId1: number;
    let entryId2: number;

    beforeEach(async () => {
      // Create test entries
      const entry1 = await createBlacklistEntry(userId, {
        ...testBlacklistEntry,
        first_name: 'Alice'
      });
      entryId1 = entry1.id;

      const entry2 = await createBlacklistEntry(userId, {
        ...testBlacklistEntry,
        first_name: 'Bob',
        last_name: 'Wilson',
        reason: 'Contract dispute'
      });
      entryId2 = entry2.id;
      
      // Update the second entry to have pending status
      await db.update(blacklistEntriesTable)
        .set({ status: 'pending' })
        .where(eq(blacklistEntriesTable.id, entryId2))
        .execute();
    });

    it('should return all entries for user company', async () => {
      const filters: BlacklistFilter = {};
      const pagination: Pagination = { page: 1, limit: 20 };

      const result = await getBlacklistEntries(userId, filters, pagination);

      expect(result.entries).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.entries[0].company_id).toBe(companyId);
      expect(result.entries[1].company_id).toBe(companyId);
    });

    it('should filter by status', async () => {
      const filters: BlacklistFilter = { status: 'active' };
      const pagination: Pagination = { page: 1, limit: 20 };

      const result = await getBlacklistEntries(userId, filters, pagination);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].first_name).toBe('Alice');
      expect(result.entries[0].status).toBe('active');
    });

    it('should filter by search text', async () => {
      const filters: BlacklistFilter = { search: 'Wilson' };
      const pagination: Pagination = { page: 1, limit: 20 };

      const result = await getBlacklistEntries(userId, filters, pagination);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].last_name).toBe('Wilson');
    });

    it('should filter by score range', async () => {
      const filters: BlacklistFilter = { min_score: 70, max_score: 90 };
      const pagination: Pagination = { page: 1, limit: 20 };

      const result = await getBlacklistEntries(userId, filters, pagination);

      expect(result.entries.length).toBeGreaterThan(0);
      result.entries.forEach(entry => {
        expect(entry.blacklist_score).toBeGreaterThanOrEqual(70);
        expect(entry.blacklist_score).toBeLessThanOrEqual(90);
      });
    });

    it('should apply pagination correctly', async () => {
      const filters: BlacklistFilter = {};
      const pagination: Pagination = { page: 1, limit: 1 };

      const result = await getBlacklistEntries(userId, filters, pagination);

      expect(result.entries).toHaveLength(1);
      expect(result.total).toBe(2);
    });

    it('should order by created_at descending', async () => {
      const filters: BlacklistFilter = {};
      const pagination: Pagination = { page: 1, limit: 20 };

      const result = await getBlacklistEntries(userId, filters, pagination);

      expect(result.entries).toHaveLength(2);
      // Second entry should be first due to DESC ordering
      expect(result.entries[0].first_name).toBe('Bob');
      expect(result.entries[1].first_name).toBe('Alice');
    });
  });

  describe('getBlacklistEntry', () => {
    let entryId: number;

    beforeEach(async () => {
      const entry = await createBlacklistEntry(userId, testBlacklistEntry);
      entryId = entry.id;
    });

    it('should return entry by ID', async () => {
      const result = await getBlacklistEntry(userId, entryId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(entryId);
      expect(result!.first_name).toBe('Jane');
      expect(result!.company_id).toBe(companyId);
    });

    it('should return null for non-existent entry', async () => {
      const result = await getBlacklistEntry(userId, 999);
      expect(result).toBeNull();
    });

    it('should not return entry from different company', async () => {
      // Create another user and company
      const otherUser = await db.insert(usersTable)
        .values({
          ...testUser,
          email: 'other@example.com'
        })
        .returning()
        .execute();

      const otherCompany = await db.insert(companiesTable)
        .values({
          ...testCompany,
          user_id: otherUser[0].id,
          name: 'Other Company'
        })
        .returning()
        .execute();

      const result = await getBlacklistEntry(otherUser[0].id, entryId);
      expect(result).toBeNull();
    });
  });

  describe('updateBlacklistEntry', () => {
    let entryId: number;

    beforeEach(async () => {
      const entry = await createBlacklistEntry(userId, testBlacklistEntry);
      entryId = entry.id;
    });

    it('should update entry fields', async () => {
      const updateData: UpdateBlacklistEntry = {
        id: entryId,
        first_name: 'Updated Jane',
        reason: 'Updated reason',
        status: 'resolved'
      };

      const result = await updateBlacklistEntry(userId, updateData);

      expect(result.id).toBe(entryId);
      expect(result.first_name).toBe('Updated Jane');
      expect(result.reason).toBe('Updated reason');
      expect(result.status).toBe('resolved');
      expect(result.updated_at).toBeInstanceOf(Date);
    });

    it('should recalculate score when reason changes', async () => {
      const originalEntry = await getBlacklistEntry(userId, entryId);
      const originalScore = originalEntry!.blacklist_score;

      const updateData: UpdateBlacklistEntry = {
        id: entryId,
        reason: 'Minor contract dispute' // Lower risk
      };

      const result = await updateBlacklistEntry(userId, updateData);
      expect(result.blacklist_score).toBeLessThan(originalScore);
    });

    it('should log update activity', async () => {
      const updateData: UpdateBlacklistEntry = {
        id: entryId,
        first_name: 'Updated Jane'
      };

      await updateBlacklistEntry(userId, updateData);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(
          and(
            eq(activityLogsTable.user_id, userId),
            eq(activityLogsTable.action, 'updated'),
            eq(activityLogsTable.resource_id, entryId)
          )
        )
        .execute();

      expect(activities).toHaveLength(1);
    });

    it('should throw error for non-existent entry', async () => {
      const updateData: UpdateBlacklistEntry = {
        id: 999,
        first_name: 'Updated'
      };

      await expect(updateBlacklistEntry(userId, updateData))
        .rejects.toThrow(/not found or access denied/i);
    });
  });

  describe('deleteBlacklistEntry', () => {
    let entryId: number;

    beforeEach(async () => {
      const entry = await createBlacklistEntry(userId, testBlacklistEntry);
      entryId = entry.id;
    });

    it('should delete entry successfully', async () => {
      const result = await deleteBlacklistEntry(userId, entryId);
      expect(result.success).toBe(true);

      // Verify entry is deleted
      const deletedEntry = await getBlacklistEntry(userId, entryId);
      expect(deletedEntry).toBeNull();
    });

    it('should log deletion activity', async () => {
      await deleteBlacklistEntry(userId, entryId);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(
          and(
            eq(activityLogsTable.user_id, userId),
            eq(activityLogsTable.action, 'deleted'),
            eq(activityLogsTable.resource_id, entryId)
          )
        )
        .execute();

      expect(activities).toHaveLength(1);
    });

    it('should throw error for non-existent entry', async () => {
      await expect(deleteBlacklistEntry(userId, 999))
        .rejects.toThrow(/not found or access denied/i);
    });
  });

  describe('toggleBlacklistStatus', () => {
    let entryId: number;

    beforeEach(async () => {
      const entry = await createBlacklistEntry(userId, {
        ...testBlacklistEntry,
        is_blacklisted: true
      });
      entryId = entry.id;
    });

    it('should blacklist an entry', async () => {
      const result = await toggleBlacklistStatus(userId, entryId, true);

      expect(result.id).toBe(entryId);
      expect(result.is_blacklisted).toBe(true);
      expect(result.status).toBe('active');
    });

    it('should unblacklist an entry', async () => {
      const result = await toggleBlacklistStatus(userId, entryId, false);

      expect(result.id).toBe(entryId);
      expect(result.is_blacklisted).toBe(false);
      expect(result.status).toBe('inactive');
    });

    it('should log blacklist activity', async () => {
      await toggleBlacklistStatus(userId, entryId, true);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(
          and(
            eq(activityLogsTable.user_id, userId),
            eq(activityLogsTable.action, 'blacklisted'),
            eq(activityLogsTable.resource_id, entryId)
          )
        )
        .execute();

      expect(activities).toHaveLength(1);
    });

    it('should log unblacklist activity', async () => {
      await toggleBlacklistStatus(userId, entryId, false);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(
          and(
            eq(activityLogsTable.user_id, userId),
            eq(activityLogsTable.action, 'unblacklisted'),
            eq(activityLogsTable.resource_id, entryId)
          )
        )
        .execute();

      expect(activities).toHaveLength(1);
    });

    it('should throw error for non-existent entry', async () => {
      await expect(toggleBlacklistStatus(userId, 999, true))
        .rejects.toThrow(/not found or access denied/i);
    });
  });
});