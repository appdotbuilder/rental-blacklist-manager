import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, companiesTable, blacklistEntriesTable, activityLogsTable } from '../db/schema';
import { getDashboardAnalytics, getRecentActivity } from '../handlers/dashboard';

describe('dashboard handlers', () => {
  beforeEach(createDB);
  afterEach(resetDB);

  describe('getDashboardAnalytics', () => {
    it('should return analytics for user with company', async () => {
      // Create test user
      const [user] = await db.insert(usersTable)
        .values({
          email: 'test@example.com',
          password_hash: 'hashed_password',
          first_name: 'John',
          last_name: 'Doe',
          phone: '1234567890',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      // Create test company
      const [company] = await db.insert(companiesTable)
        .values({
          user_id: user.id,
          name: 'Test Company',
          legal_representative_name: 'John Doe',
          phone: '1234567890',
          address: '123 Test St',
          city: 'Test City'
        })
        .returning()
        .execute();

      // Create blacklist entries with different statuses and scores
      await db.insert(blacklistEntriesTable)
        .values([
          {
            user_id: user.id,
            company_id: company.id,
            first_name: 'Active',
            last_name: 'Person1',
            id_number: 'ID001',
            reason: 'Test reason',
            status: 'active',
            is_blacklisted: true,
            blacklist_score: 15
          },
          {
            user_id: user.id,
            company_id: company.id,
            first_name: 'Active',
            last_name: 'Person2',
            id_number: 'ID002',
            reason: 'Test reason',
            status: 'active',
            is_blacklisted: true,
            blacklist_score: 35
          },
          {
            user_id: user.id,
            company_id: company.id,
            first_name: 'Pending',
            last_name: 'Person',
            id_number: 'ID003',
            reason: 'Test reason',
            status: 'pending',
            is_blacklisted: false,
            blacklist_score: 55
          },
          {
            user_id: user.id,
            company_id: company.id,
            first_name: 'Resolved',
            last_name: 'Person',
            id_number: 'ID004',
            reason: 'Test reason',
            status: 'resolved',
            is_blacklisted: false,
            blacklist_score: 75
          },
          {
            user_id: user.id,
            company_id: company.id,
            first_name: 'High',
            last_name: 'Risk',
            id_number: 'ID005',
            reason: 'Test reason',
            status: 'active',
            is_blacklisted: true,
            blacklist_score: 90
          }
        ])
        .execute();

      // Create activity logs
      await db.insert(activityLogsTable)
        .values([
          {
            user_id: user.id,
            action: 'create',
            resource_type: 'blacklist_entry'
          },
          {
            user_id: user.id,
            action: 'update',
            resource_type: 'blacklist_entry'
          }
        ])
        .execute();

      const result = await getDashboardAnalytics(user.id);

      // Verify basic counts
      expect(result.total_entries).toEqual(5);
      expect(result.active_blacklisted).toEqual(3);
      expect(result.pending_entries).toEqual(1);
      expect(result.resolved_entries).toEqual(1);

      // Verify risk score distribution
      expect(result.risk_score_distribution).toHaveLength(5);
      expect(result.risk_score_distribution.find(r => r.range === '0-20')?.count).toEqual(1);
      expect(result.risk_score_distribution.find(r => r.range === '21-40')?.count).toEqual(1);
      expect(result.risk_score_distribution.find(r => r.range === '41-60')?.count).toEqual(1);
      expect(result.risk_score_distribution.find(r => r.range === '61-80')?.count).toEqual(1);
      expect(result.risk_score_distribution.find(r => r.range === '81-100')?.count).toEqual(1);

      // Verify recent activities
      expect(result.recent_activities).toHaveLength(2);
      expect(result.recent_activities[0]).toHaveProperty('id');
      expect(result.recent_activities[0]).toHaveProperty('action');
      expect(result.recent_activities[0]).toHaveProperty('resource_type');
      expect(result.recent_activities[0]).toHaveProperty('user_name', 'John Doe');
      expect(result.recent_activities[0]).toHaveProperty('created_at');
    });

    it('should return empty analytics for user with no blacklist entries', async () => {
      // Create test user
      const [user] = await db.insert(usersTable)
        .values({
          email: 'test@example.com',
          password_hash: 'hashed_password',
          first_name: 'John',
          last_name: 'Doe',
          phone: '1234567890',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      // Create test company
      await db.insert(companiesTable)
        .values({
          user_id: user.id,
          name: 'Test Company',
          legal_representative_name: 'John Doe',
          phone: '1234567890',
          address: '123 Test St',
          city: 'Test City'
        })
        .execute();

      const result = await getDashboardAnalytics(user.id);

      expect(result.total_entries).toEqual(0);
      expect(result.active_blacklisted).toEqual(0);
      expect(result.pending_entries).toEqual(0);
      expect(result.resolved_entries).toEqual(0);
      
      // All risk score ranges should be empty
      result.risk_score_distribution.forEach(range => {
        expect(range.count).toEqual(0);
      });
      
      expect(result.recent_activities).toHaveLength(0);
    });

    it('should throw error for user without company', async () => {
      // Create test user without company
      const [user] = await db.insert(usersTable)
        .values({
          email: 'test@example.com',
          password_hash: 'hashed_password',
          first_name: 'John',
          last_name: 'Doe',
          phone: '1234567890',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      await expect(getDashboardAnalytics(user.id))
        .rejects.toThrow(/company not found/i);
    });

    it('should only count company-specific entries', async () => {
      // Create two users with companies
      const [user1] = await db.insert(usersTable)
        .values({
          email: 'user1@example.com',
          password_hash: 'hashed_password',
          first_name: 'User',
          last_name: 'One',
          phone: '1234567890',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      const [user2] = await db.insert(usersTable)
        .values({
          email: 'user2@example.com',
          password_hash: 'hashed_password',
          first_name: 'User',
          last_name: 'Two',
          phone: '1234567891',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      const [company1] = await db.insert(companiesTable)
        .values({
          user_id: user1.id,
          name: 'Company One',
          legal_representative_name: 'User One',
          phone: '1234567890',
          address: '123 Test St',
          city: 'Test City'
        })
        .returning()
        .execute();

      const [company2] = await db.insert(companiesTable)
        .values({
          user_id: user2.id,
          name: 'Company Two',
          legal_representative_name: 'User Two',
          phone: '1234567891',
          address: '456 Test St',
          city: 'Test City'
        })
        .returning()
        .execute();

      // Create entries for both companies
      await db.insert(blacklistEntriesTable)
        .values([
          {
            user_id: user1.id,
            company_id: company1.id,
            first_name: 'Company1',
            last_name: 'Entry1',
            id_number: 'C1-001',
            reason: 'Test reason',
            status: 'active',
            is_blacklisted: true,
            blacklist_score: 50
          },
          {
            user_id: user1.id,
            company_id: company1.id,
            first_name: 'Company1',
            last_name: 'Entry2',
            id_number: 'C1-002',
            reason: 'Test reason',
            status: 'pending',
            is_blacklisted: false,
            blacklist_score: 30
          },
          {
            user_id: user2.id,
            company_id: company2.id,
            first_name: 'Company2',
            last_name: 'Entry1',
            id_number: 'C2-001',
            reason: 'Test reason',
            status: 'active',
            is_blacklisted: true,
            blacklist_score: 70
          }
        ])
        .execute();

      const result1 = await getDashboardAnalytics(user1.id);
      const result2 = await getDashboardAnalytics(user2.id);

      // User1 should only see their company's entries
      expect(result1.total_entries).toEqual(2);
      expect(result1.active_blacklisted).toEqual(1);
      expect(result1.pending_entries).toEqual(1);

      // User2 should only see their company's entries
      expect(result2.total_entries).toEqual(1);
      expect(result2.active_blacklisted).toEqual(1);
      expect(result2.pending_entries).toEqual(0);
    });
  });

  describe('getRecentActivity', () => {
    it('should return recent activities for user company', async () => {
      // Create test user
      const [user] = await db.insert(usersTable)
        .values({
          email: 'test@example.com',
          password_hash: 'hashed_password',
          first_name: 'John',
          last_name: 'Doe',
          phone: '1234567890',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      // Create test company
      await db.insert(companiesTable)
        .values({
          user_id: user.id,
          name: 'Test Company',
          legal_representative_name: 'John Doe',
          phone: '1234567890',
          address: '123 Test St',
          city: 'Test City'
        })
        .execute();

      // Create activity logs
      await db.insert(activityLogsTable)
        .values([
          {
            user_id: user.id,
            action: 'create',
            resource_type: 'blacklist_entry',
            details: 'Created new blacklist entry'
          },
          {
            user_id: user.id,
            action: 'update',
            resource_type: 'blacklist_entry',
            details: 'Updated blacklist entry status'
          },
          {
            user_id: user.id,
            action: 'delete',
            resource_type: 'blacklist_entry',
            details: 'Deleted blacklist entry'
          }
        ])
        .execute();

      const result = await getRecentActivity(user.id, 5);

      expect(result).toHaveLength(3);
      
      // Check that activities are ordered by created_at (most recent first)
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].created_at.getTime()).toBeGreaterThanOrEqual(
          result[i].created_at.getTime()
        );
      }

      // Verify structure of each activity
      result.forEach(activity => {
        expect(activity).toHaveProperty('id');
        expect(activity).toHaveProperty('action');
        expect(activity).toHaveProperty('resource_type');
        expect(activity).toHaveProperty('user_name', 'John Doe');
        expect(activity).toHaveProperty('created_at');
        expect(activity.created_at).toBeInstanceOf(Date);
      });
    });

    it('should respect limit parameter', async () => {
      // Create test user
      const [user] = await db.insert(usersTable)
        .values({
          email: 'test@example.com',
          password_hash: 'hashed_password',
          first_name: 'John',
          last_name: 'Doe',
          phone: '1234567890',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      // Create test company
      await db.insert(companiesTable)
        .values({
          user_id: user.id,
          name: 'Test Company',
          legal_representative_name: 'John Doe',
          phone: '1234567890',
          address: '123 Test St',
          city: 'Test City'
        })
        .execute();

      // Create 5 activity logs
      await db.insert(activityLogsTable)
        .values([
          { user_id: user.id, action: 'create', resource_type: 'blacklist_entry' },
          { user_id: user.id, action: 'update', resource_type: 'blacklist_entry' },
          { user_id: user.id, action: 'delete', resource_type: 'blacklist_entry' },
          { user_id: user.id, action: 'view', resource_type: 'blacklist_entry' },
          { user_id: user.id, action: 'search', resource_type: 'blacklist_entry' }
        ])
        .execute();

      const result = await getRecentActivity(user.id, 3);

      expect(result).toHaveLength(3);
    });

    it('should return empty array for user with no activities', async () => {
      // Create test user
      const [user] = await db.insert(usersTable)
        .values({
          email: 'test@example.com',
          password_hash: 'hashed_password',
          first_name: 'John',
          last_name: 'Doe',
          phone: '1234567890',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      // Create test company
      await db.insert(companiesTable)
        .values({
          user_id: user.id,
          name: 'Test Company',
          legal_representative_name: 'John Doe',
          phone: '1234567890',
          address: '123 Test St',
          city: 'Test City'
        })
        .execute();

      const result = await getRecentActivity(user.id);

      expect(result).toHaveLength(0);
    });

    it('should throw error for user without company', async () => {
      // Create test user without company
      const [user] = await db.insert(usersTable)
        .values({
          email: 'test@example.com',
          password_hash: 'hashed_password',
          first_name: 'John',
          last_name: 'Doe',
          phone: '1234567890',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      await expect(getRecentActivity(user.id))
        .rejects.toThrow(/company not found/i);
    });

    it('should only return activities for user company', async () => {
      // Create two users with companies
      const [user1] = await db.insert(usersTable)
        .values({
          email: 'user1@example.com',
          password_hash: 'hashed_password',
          first_name: 'User',
          last_name: 'One',
          phone: '1234567890',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      const [user2] = await db.insert(usersTable)
        .values({
          email: 'user2@example.com',
          password_hash: 'hashed_password',
          first_name: 'User',
          last_name: 'Two',
          phone: '1234567891',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .returning()
        .execute();

      await db.insert(companiesTable)
        .values([
          {
            user_id: user1.id,
            name: 'Company One',
            legal_representative_name: 'User One',
            phone: '1234567890',
            address: '123 Test St',
            city: 'Test City'
          },
          {
            user_id: user2.id,
            name: 'Company Two',
            legal_representative_name: 'User Two',
            phone: '1234567891',
            address: '456 Test St',
            city: 'Test City'
          }
        ])
        .execute();

      // Create activities for both users
      await db.insert(activityLogsTable)
        .values([
          {
            user_id: user1.id,
            action: 'create',
            resource_type: 'blacklist_entry'
          },
          {
            user_id: user1.id,
            action: 'update',
            resource_type: 'blacklist_entry'
          },
          {
            user_id: user2.id,
            action: 'create',
            resource_type: 'blacklist_entry'
          }
        ])
        .execute();

      const result1 = await getRecentActivity(user1.id);
      const result2 = await getRecentActivity(user2.id);

      // User1 should only see their company's activities
      expect(result1).toHaveLength(2);
      result1.forEach(activity => {
        expect(activity.user_name).toEqual('User One');
      });

      // User2 should only see their company's activities
      expect(result2).toHaveLength(1);
      result2.forEach(activity => {
        expect(activity.user_name).toEqual('User Two');
      });
    });
  });
});