import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, companiesTable, sessionsTable, activityLogsTable } from '../db/schema';
import { 
  type UpdateProfile, 
  type UpdateCompany, 
  type ChangePassword,
  type ToggleTwoFactor,
  type ActivityLogFilter,
  type Pagination
} from '../schema';
import {
  updateProfile,
  updateCompany,
  changePassword,
  toggleTwoFactor,
  getUserSessions,
  terminateSession,
  terminateAllSessions,
  getActivityLogs,
  exportActivityLogs,
  getUserRole
} from '../handlers/settings';
import { eq } from 'drizzle-orm';

// Simple password hashing function for tests (same as in handler)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

describe('Settings Handlers', () => {
  let testUserId: number;
  let testCompanyId: number;
  let adminUserId: number;

  beforeEach(async () => {
    await createDB();

    // Create test user
    const testUser = await db.insert(usersTable)
      .values({
        email: 'test@example.com',
        password_hash: await hashPassword('password123'),
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890',
        is_admin: false,
        is_active: true,
        two_fa_enabled: false,
        two_fa_secret: null,
        remember_token: null,
        last_login: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning()
      .execute();
    testUserId = testUser[0].id;

    // Create admin user
    const adminUser = await db.insert(usersTable)
      .values({
        email: 'admin@example.com',
        password_hash: await hashPassword('adminpass'),
        first_name: 'Admin',
        last_name: 'User',
        phone: '+1987654321',
        is_admin: true,
        is_active: true,
        two_fa_enabled: false,
        two_fa_secret: null,
        remember_token: null,
        last_login: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning()
      .execute();
    adminUserId = adminUser[0].id;

    // Create test company
    const testCompany = await db.insert(companiesTable)
      .values({
        user_id: testUserId,
        name: 'Test Company',
        legal_representative_name: 'John Doe',
        phone: '+1234567890',
        address: '123 Main St',
        city: 'Test City',
        association_membership: 'Test Association',
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning()
      .execute();
    testCompanyId = testCompany[0].id;
  });

  afterEach(resetDB);

  describe('updateProfile', () => {
    it('should update user profile successfully', async () => {
      const updateInput: UpdateProfile = {
        first_name: 'Jane',
        last_name: 'Smith',
        phone: '+1555123456',
        email: 'jane.smith@example.com'
      };

      const result = await updateProfile(testUserId, updateInput);

      expect(result.first_name).toEqual('Jane');
      expect(result.last_name).toEqual('Smith');
      expect(result.phone).toEqual('+1555123456');
      expect(result.email).toEqual('jane.smith@example.com');
      expect(result.updated_at).toBeInstanceOf(Date);
    });

    it('should update only provided fields', async () => {
      const updateInput: UpdateProfile = {
        first_name: 'Jane'
      };

      const result = await updateProfile(testUserId, updateInput);

      expect(result.first_name).toEqual('Jane');
      expect(result.last_name).toEqual('Doe'); // Should remain unchanged
      expect(result.email).toEqual('test@example.com'); // Should remain unchanged
    });

    it('should throw error if user not found', async () => {
      const updateInput: UpdateProfile = {
        first_name: 'Jane'
      };

      await expect(updateProfile(99999, updateInput)).rejects.toThrow('User not found');
    });

    it('should throw error if email already exists', async () => {
      // Create another user first
      await db.insert(usersTable)
        .values({
          email: 'existing@example.com',
          password_hash: 'hash',
          first_name: 'Existing',
          last_name: 'User',
          phone: '+1111111111',
          is_admin: false,
          is_active: true,
          two_fa_enabled: false
        })
        .execute();

      const updateInput: UpdateProfile = {
        email: 'existing@example.com'
      };

      await expect(updateProfile(testUserId, updateInput)).rejects.toThrow('Email already exists');
    });

    it('should log profile update activity', async () => {
      const updateInput: UpdateProfile = {
        first_name: 'Jane'
      };

      await updateProfile(testUserId, updateInput);

      const logs = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(logs).toHaveLength(1);
      expect(logs[0].action).toEqual('update_profile');
      expect(logs[0].resource_type).toEqual('user');
      expect(logs[0].resource_id).toEqual(testUserId);
    });
  });

  describe('updateCompany', () => {
    it('should update company successfully', async () => {
      const updateInput: UpdateCompany = {
        name: 'Updated Company',
        legal_representative_name: 'Jane Doe',
        phone: '+1555987654',
        address: '456 Oak St',
        city: 'Updated City',
        association_membership: 'Updated Association'
      };

      const result = await updateCompany(testUserId, updateInput);

      expect(result.name).toEqual('Updated Company');
      expect(result.legal_representative_name).toEqual('Jane Doe');
      expect(result.phone).toEqual('+1555987654');
      expect(result.address).toEqual('456 Oak St');
      expect(result.city).toEqual('Updated City');
      expect(result.association_membership).toEqual('Updated Association');
    });

    it('should throw error if company not found', async () => {
      const updateInput: UpdateCompany = {
        name: 'Updated Company'
      };

      await expect(updateCompany(99999, updateInput)).rejects.toThrow('Company not found');
    });

    it('should log company update activity', async () => {
      const updateInput: UpdateCompany = {
        name: 'Updated Company'
      };

      await updateCompany(testUserId, updateInput);

      const logs = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(logs).toHaveLength(1);
      expect(logs[0].action).toEqual('update_company');
      expect(logs[0].resource_type).toEqual('company');
    });
  });

  describe('changePassword', () => {
    it('should change password successfully', async () => {
      const changeInput: ChangePassword = {
        current_password: 'password123',
        new_password: 'newpassword456',
        confirm_password: 'newpassword456'
      };

      const result = await changePassword(testUserId, changeInput);

      expect(result.success).toBe(true);

      // Verify password was actually changed in database
      const user = await db.select()
        .from(usersTable)
        .where(eq(usersTable.id, testUserId))
        .execute();

      const isNewPasswordValid = await verifyPassword('newpassword456', user[0].password_hash);
      expect(isNewPasswordValid).toBe(true);
    });

    it('should throw error if current password is incorrect', async () => {
      const changeInput: ChangePassword = {
        current_password: 'wrongpassword',
        new_password: 'newpassword456',
        confirm_password: 'newpassword456'
      };

      await expect(changePassword(testUserId, changeInput)).rejects.toThrow('Current password is incorrect');
    });

    it('should throw error if user not found', async () => {
      const changeInput: ChangePassword = {
        current_password: 'password123',
        new_password: 'newpassword456',
        confirm_password: 'newpassword456'
      };

      await expect(changePassword(99999, changeInput)).rejects.toThrow('User not found');
    });

    it('should log password change activity', async () => {
      const changeInput: ChangePassword = {
        current_password: 'password123',
        new_password: 'newpassword456',
        confirm_password: 'newpassword456'
      };

      await changePassword(testUserId, changeInput);

      const logs = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(logs).toHaveLength(1);
      expect(logs[0].action).toEqual('change_password');
    });
  });

  describe('toggleTwoFactor', () => {
    it('should enable 2FA successfully with valid code', async () => {
      const toggleInput: ToggleTwoFactor = {
        enable: true,
        code: '123456' // This matches our mock verification
      };

      const result = await toggleTwoFactor(testUserId, toggleInput);

      expect(result.success).toBe(true);
      expect(result.qr_code).toBeDefined();
      expect(result.backup_codes).toHaveLength(8);

      // Verify 2FA was enabled in database
      const user = await db.select()
        .from(usersTable)
        .where(eq(usersTable.id, testUserId))
        .execute();

      expect(user[0].two_fa_enabled).toBe(true);
      expect(user[0].two_fa_secret).toBeDefined();
    });

    it('should throw error with invalid 2FA code', async () => {
      const toggleInput: ToggleTwoFactor = {
        enable: true,
        code: '654321' // Invalid code
      };

      await expect(toggleTwoFactor(testUserId, toggleInput)).rejects.toThrow('Invalid 2FA code');
    });

    it('should throw error when enabling without code', async () => {
      const toggleInput: ToggleTwoFactor = {
        enable: true
      };

      await expect(toggleTwoFactor(testUserId, toggleInput)).rejects.toThrow('2FA code is required when enabling');
    });

    it('should throw error when disabling without code', async () => {
      const toggleInput: ToggleTwoFactor = {
        enable: false
      };

      await expect(toggleTwoFactor(testUserId, toggleInput)).rejects.toThrow('2FA code is required when disabling');
    });

    it('should throw error if user not found', async () => {
      const toggleInput: ToggleTwoFactor = {
        enable: true,
        code: '123456'
      };

      await expect(toggleTwoFactor(99999, toggleInput)).rejects.toThrow('User not found');
    });
  });

  describe('getUserSessions', () => {
    it('should return user sessions', async () => {
      // Create test sessions
      await db.insert(sessionsTable)
        .values([
          {
            id: 'session1',
            user_id: testUserId,
            ip_address: '192.168.1.1',
            user_agent: 'Mozilla/5.0',
            last_activity: new Date(),
            created_at: new Date()
          },
          {
            id: 'session2',
            user_id: testUserId,
            ip_address: '192.168.1.2',
            user_agent: 'Chrome/100',
            last_activity: new Date(Date.now() - 60000), // 1 minute ago
            created_at: new Date()
          }
        ])
        .execute();

      const sessions = await getUserSessions(testUserId);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toEqual('session1'); // Should be ordered by last_activity desc
      expect(sessions[1].id).toEqual('session2');
    });

    it('should return empty array for user with no sessions', async () => {
      const sessions = await getUserSessions(testUserId);
      expect(sessions).toHaveLength(0);
    });
  });

  describe('terminateSession', () => {
    it('should terminate session successfully', async () => {
      // Create test session
      await db.insert(sessionsTable)
        .values({
          id: 'session1',
          user_id: testUserId,
          ip_address: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
          last_activity: new Date(),
          created_at: new Date()
        })
        .execute();

      const result = await terminateSession(testUserId, 'session1');

      expect(result.success).toBe(true);

      // Verify session was deleted
      const sessions = await db.select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, 'session1'))
        .execute();

      expect(sessions).toHaveLength(0);
    });

    it('should throw error if session not found or belongs to different user', async () => {
      await expect(terminateSession(testUserId, 'nonexistent')).rejects.toThrow('Session not found or does not belong to user');
    });

    it('should log session termination activity', async () => {
      // Create test session
      await db.insert(sessionsTable)
        .values({
          id: 'session1',
          user_id: testUserId,
          ip_address: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
          last_activity: new Date(),
          created_at: new Date()
        })
        .execute();

      await terminateSession(testUserId, 'session1');

      const logs = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(logs).toHaveLength(1);
      expect(logs[0].action).toEqual('terminate_session');
    });
  });

  describe('terminateAllSessions', () => {
    it('should terminate all sessions except current one', async () => {
      // Create test sessions
      await db.insert(sessionsTable)
        .values([
          {
            id: 'current_session',
            user_id: testUserId,
            ip_address: '192.168.1.1',
            user_agent: 'Mozilla/5.0',
            last_activity: new Date(),
            created_at: new Date()
          },
          {
            id: 'session2',
            user_id: testUserId,
            ip_address: '192.168.1.2',
            user_agent: 'Chrome/100',
            last_activity: new Date(),
            created_at: new Date()
          },
          {
            id: 'session3',
            user_id: testUserId,
            ip_address: '192.168.1.3',
            user_agent: 'Safari/100',
            last_activity: new Date(),
            created_at: new Date()
          }
        ])
        .execute();

      const result = await terminateAllSessions(testUserId, 'current_session');

      expect(result.success).toBe(true);

      // Verify only current session remains
      const remainingSessions = await db.select()
        .from(sessionsTable)
        .where(eq(sessionsTable.user_id, testUserId))
        .execute();

      expect(remainingSessions).toHaveLength(1);
      expect(remainingSessions[0].id).toEqual('current_session');
    });

    it('should log bulk session termination activity', async () => {
      await terminateAllSessions(testUserId, 'current_session');

      const logs = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(logs).toHaveLength(1);
      expect(logs[0].action).toEqual('terminate_all_sessions');
    });
  });

  describe('getActivityLogs', () => {
    it('should return activity logs for regular user (own logs only)', async () => {
      // Create test activity logs
      await db.insert(activityLogsTable)
        .values([
          {
            user_id: testUserId,
            action: 'create_blacklist_entry',
            resource_type: 'blacklist_entry',
            resource_id: 1,
            details: 'Created entry',
            created_at: new Date()
          },
          {
            user_id: adminUserId,
            action: 'admin_action',
            resource_type: 'user',
            resource_id: 2,
            details: 'Admin action',
            created_at: new Date()
          }
        ])
        .execute();

      const filters: ActivityLogFilter = {};
      const pagination: Pagination = { page: 1, limit: 20 };

      const result = await getActivityLogs(testUserId, filters, pagination);

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].user_id).toEqual(testUserId);
      expect(result.total).toEqual(1);
    });

    it('should return all activity logs for admin user', async () => {
      // Create test activity logs
      await db.insert(activityLogsTable)
        .values([
          {
            user_id: testUserId,
            action: 'user_action',
            resource_type: 'blacklist_entry',
            resource_id: 1,
            details: 'User action',
            created_at: new Date()
          },
          {
            user_id: adminUserId,
            action: 'admin_action',
            resource_type: 'user',
            resource_id: 2,
            details: 'Admin action',
            created_at: new Date()
          }
        ])
        .execute();

      const filters: ActivityLogFilter = {};
      const pagination: Pagination = { page: 1, limit: 20 };

      const result = await getActivityLogs(adminUserId, filters, pagination);

      expect(result.logs).toHaveLength(2);
      expect(result.total).toEqual(2);
    });

    it('should apply filters correctly', async () => {
      // Create test activity logs
      await db.insert(activityLogsTable)
        .values([
          {
            user_id: testUserId,
            action: 'create_blacklist_entry',
            resource_type: 'blacklist_entry',
            resource_id: 1,
            details: 'Created entry',
            created_at: new Date()
          },
          {
            user_id: testUserId,
            action: 'update_profile',
            resource_type: 'user',
            resource_id: testUserId,
            details: 'Updated profile',
            created_at: new Date()
          }
        ])
        .execute();

      const filters: ActivityLogFilter = {
        action: 'create_blacklist_entry'
      };
      const pagination: Pagination = { page: 1, limit: 20 };

      const result = await getActivityLogs(testUserId, filters, pagination);

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].action).toEqual('create_blacklist_entry');
    });

    it('should apply pagination correctly', async () => {
      // Create multiple test activity logs
      for (let i = 0; i < 5; i++) {
        await db.insert(activityLogsTable)
          .values({
            user_id: testUserId,
            action: `action_${i}`,
            resource_type: 'test',
            resource_id: i,
            details: `Action ${i}`,
            created_at: new Date(Date.now() - i * 1000) // Different timestamps
          })
          .execute();
      }

      const filters: ActivityLogFilter = {};
      const pagination: Pagination = { page: 2, limit: 2 };

      const result = await getActivityLogs(testUserId, filters, pagination);

      expect(result.logs).toHaveLength(2);
      expect(result.total).toEqual(5);
    });
  });

  describe('exportActivityLogs', () => {
    it('should return download URL for export', async () => {
      const filters: ActivityLogFilter = {};

      const result = await exportActivityLogs(testUserId, filters);

      expect(result.download_url).toMatch(/^https:\/\/api\.blacklist-system\.com\/exports\/activity-logs-.*\.csv$/);
    });

    it('should log export activity', async () => {
      const filters: ActivityLogFilter = {};

      await exportActivityLogs(testUserId, filters);

      const logs = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(logs).toHaveLength(1);
      expect(logs[0].action).toEqual('export_activity_logs');
    });
  });

  describe('getUserRole', () => {
    it('should return user role and permissions for regular user', async () => {
      const result = await getUserRole(testUserId);

      expect(result.role).toEqual('user');
      expect(result.permissions).toContain('read_blacklist');
      expect(result.permissions).toContain('write_blacklist');
      expect(result.permissions).not.toContain('manage_users');
    });

    it('should return admin role and permissions for admin user', async () => {
      const result = await getUserRole(adminUserId);

      expect(result.role).toEqual('admin');
      expect(result.permissions).toContain('read_blacklist');
      expect(result.permissions).toContain('write_blacklist');
      expect(result.permissions).toContain('manage_users');
      expect(result.permissions).toContain('system_settings');
    });

    it('should throw error if user not found', async () => {
      await expect(getUserRole(99999)).rejects.toThrow('User not found');
    });
  });
});