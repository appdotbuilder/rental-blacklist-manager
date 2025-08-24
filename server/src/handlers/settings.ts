import { db } from '../db';
import { 
  usersTable, 
  companiesTable, 
  sessionsTable, 
  activityLogsTable 
} from '../db/schema';
import { 
  type UpdateProfile, 
  type UpdateCompany, 
  type ChangePassword, 
  type ToggleTwoFactor,
  type User, 
  type Company,
  type Session,
  type ActivityLog,
  type ActivityLogFilter,
  type Pagination
} from '../schema';
import { eq, and, gte, lte, count, desc, ne, SQL } from 'drizzle-orm';

// Simple password hashing function (in production, use bcrypt)
async function hashPassword(password: string): Promise<string> {
  // Simple hash for demo - in production use bcrypt
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

// Simple 2FA secret generation and verification
function generateSecret(): string {
  return Array.from({ length: 32 }, () => 
    Math.random().toString(36).charAt(0)
  ).join('').toUpperCase();
}

function verifyTwoFactorCode(secret: string, code: string): boolean {
  // Simple verification for demo - in production use speakeasy
  return code === '123456'; // Mock verification
}

function generateQRCode(secret: string, email: string): string {
  // Simple QR code data URL for demo - in production use qrcode library
  return `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==`;
}

export async function updateProfile(userId: number, input: UpdateProfile): Promise<User> {
  try {
    // Find user by ID
    const existingUser = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .execute();

    if (existingUser.length === 0) {
      throw new Error('User not found');
    }

    // If email is being changed, validate uniqueness
    if (input.email && input.email !== existingUser[0].email) {
      const emailExists = await db.select()
        .from(usersTable)
        .where(and(
          eq(usersTable.email, input.email),
          ne(usersTable.id, userId)
        ))
        .execute();

      if (emailExists.length > 0) {
        throw new Error('Email already exists');
      }
    }

    // Update user profile
    const updatedUser = await db.update(usersTable)
      .set({
        ...input,
        updated_at: new Date()
      })
      .where(eq(usersTable.id, userId))
      .returning()
      .execute();

    // Log profile update activity
    await db.insert(activityLogsTable)
      .values({
        user_id: userId,
        action: 'update_profile',
        resource_type: 'user',
        resource_id: userId,
        details: `Updated profile fields: ${Object.keys(input).join(', ')}`
      })
      .execute();

    return updatedUser[0];
  } catch (error) {
    console.error('Profile update failed:', error);
    throw error;
  }
}

export async function updateCompany(userId: number, input: UpdateCompany): Promise<Company> {
  try {
    // Find company by user ID
    const existingCompany = await db.select()
      .from(companiesTable)
      .where(eq(companiesTable.user_id, userId))
      .execute();

    if (existingCompany.length === 0) {
      throw new Error('Company not found');
    }

    // Update company information
    const updatedCompany = await db.update(companiesTable)
      .set({
        ...input,
        updated_at: new Date()
      })
      .where(eq(companiesTable.user_id, userId))
      .returning()
      .execute();

    // Log company update activity
    await db.insert(activityLogsTable)
      .values({
        user_id: userId,
        action: 'update_company',
        resource_type: 'company',
        resource_id: updatedCompany[0].id,
        details: `Updated company fields: ${Object.keys(input).join(', ')}`
      })
      .execute();

    return updatedCompany[0];
  } catch (error) {
    console.error('Company update failed:', error);
    throw error;
  }
}

export async function changePassword(userId: number, input: ChangePassword): Promise<{ success: boolean }> {
  try {
    // Find user by ID
    const existingUser = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .execute();

    if (existingUser.length === 0) {
      throw new Error('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await verifyPassword(input.current_password, existingUser[0].password_hash);
    if (!isCurrentPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await hashPassword(input.new_password);

    // Update password in database
    await db.update(usersTable)
      .set({
        password_hash: newPasswordHash,
        updated_at: new Date()
      })
      .where(eq(usersTable.id, userId))
      .execute();

    // Log password change activity
    await db.insert(activityLogsTable)
      .values({
        user_id: userId,
        action: 'change_password',
        resource_type: 'user',
        resource_id: userId,
        details: 'Password changed successfully'
      })
      .execute();

    return { success: true };
  } catch (error) {
    console.error('Password change failed:', error);
    throw error;
  }
}

export async function toggleTwoFactor(userId: number, input: ToggleTwoFactor): Promise<{ 
  success: boolean; 
  qr_code?: string; 
  backup_codes?: string[] 
}> {
  try {
    // Find user by ID
    const existingUser = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .execute();

    if (existingUser.length === 0) {
      throw new Error('User not found');
    }

    if (input.enable) {
      // Enabling 2FA
      if (!input.code) {
        throw new Error('2FA code is required when enabling');
      }

      // Generate 2FA secret if not exists
      let twoFaSecret = existingUser[0].two_fa_secret;
      if (!twoFaSecret) {
        twoFaSecret = generateSecret();
      }

      // Verify provided code
      const isValidCode = verifyTwoFactorCode(twoFaSecret, input.code);

      if (!isValidCode) {
        throw new Error('Invalid 2FA code');
      }

      // Update 2FA status
      await db.update(usersTable)
        .set({
          two_fa_enabled: true,
          two_fa_secret: twoFaSecret,
          updated_at: new Date()
        })
        .where(eq(usersTable.id, userId))
        .execute();

      // Generate QR code
      const qrCode = generateQRCode(twoFaSecret, existingUser[0].email);

      // Generate backup codes (simplified version)
      const backupCodes = Array.from({ length: 8 }, () => 
        Math.random().toString(36).substring(2, 8).toUpperCase()
      );

      // Log 2FA enable activity
      await db.insert(activityLogsTable)
        .values({
          user_id: userId,
          action: 'enable_2fa',
          resource_type: 'user',
          resource_id: userId,
          details: 'Two-factor authentication enabled'
        })
        .execute();

      return { 
        success: true, 
        qr_code: qrCode,
        backup_codes: backupCodes
      };
    } else {
      // Disabling 2FA
      if (!input.code) {
        throw new Error('2FA code is required when disabling');
      }

      // Verify provided code
      const isValidCode = verifyTwoFactorCode(existingUser[0].two_fa_secret!, input.code);

      if (!isValidCode) {
        throw new Error('Invalid 2FA code');
      }

      // Update 2FA status
      await db.update(usersTable)
        .set({
          two_fa_enabled: false,
          two_fa_secret: null,
          updated_at: new Date()
        })
        .where(eq(usersTable.id, userId))
        .execute();

      // Log 2FA disable activity
      await db.insert(activityLogsTable)
        .values({
          user_id: userId,
          action: 'disable_2fa',
          resource_type: 'user',
          resource_id: userId,
          details: 'Two-factor authentication disabled'
        })
        .execute();

      return { success: true };
    }
  } catch (error) {
    console.error('2FA toggle failed:', error);
    throw error;
  }
}

export async function getUserSessions(userId: number): Promise<Session[]> {
  try {
    // Query sessions table by user ID, ordered by last activity
    const sessions = await db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.user_id, userId))
      .orderBy(desc(sessionsTable.last_activity))
      .execute();

    return sessions;
  } catch (error) {
    console.error('Get user sessions failed:', error);
    throw error;
  }
}

export async function terminateSession(userId: number, sessionId: string): Promise<{ success: boolean }> {
  try {
    // Verify session belongs to user and delete it
    const deletedSession = await db.delete(sessionsTable)
      .where(and(
        eq(sessionsTable.id, sessionId),
        eq(sessionsTable.user_id, userId)
      ))
      .returning()
      .execute();

    if (deletedSession.length === 0) {
      throw new Error('Session not found or does not belong to user');
    }

    // Log session termination activity
    await db.insert(activityLogsTable)
      .values({
        user_id: userId,
        action: 'terminate_session',
        resource_type: 'session',
        resource_id: null,
        details: `Terminated session: ${sessionId}`
      })
      .execute();

    return { success: true };
  } catch (error) {
    console.error('Session termination failed:', error);
    throw error;
  }
}

export async function terminateAllSessions(userId: number, currentSessionId: string): Promise<{ success: boolean }> {
  try {
    // Delete all sessions for user except current session
    const deletedSessions = await db.delete(sessionsTable)
      .where(and(
        eq(sessionsTable.user_id, userId),
        ne(sessionsTable.id, currentSessionId)
      ))
      .returning()
      .execute();

    // Log bulk session termination activity
    await db.insert(activityLogsTable)
      .values({
        user_id: userId,
        action: 'terminate_all_sessions',
        resource_type: 'session',
        resource_id: null,
        details: `Terminated ${deletedSessions.length} sessions`
      })
      .execute();

    return { success: true };
  } catch (error) {
    console.error('Bulk session termination failed:', error);
    throw error;
  }
}

export async function getActivityLogs(
  userId: number, 
  filters: ActivityLogFilter, 
  pagination: Pagination
): Promise<{ logs: ActivityLog[]; total: number }> {
  try {
    // Check if user is admin to determine access level
    const user = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .execute();

    if (user.length === 0) {
      throw new Error('User not found');
    }

    const isAdmin = user[0].is_admin;

    // Build conditions array
    const conditions: SQL<unknown>[] = [];

    // If not admin, only show user's own logs
    if (!isAdmin) {
      conditions.push(eq(activityLogsTable.user_id, userId));
    }

    // Apply filters
    if (filters.user_id !== undefined) {
      conditions.push(eq(activityLogsTable.user_id, filters.user_id));
    }

    if (filters.action) {
      conditions.push(eq(activityLogsTable.action, filters.action));
    }

    if (filters.resource_type) {
      conditions.push(eq(activityLogsTable.resource_type, filters.resource_type));
    }

    if (filters.date_from) {
      conditions.push(gte(activityLogsTable.created_at, filters.date_from));
    }

    if (filters.date_to) {
      conditions.push(lte(activityLogsTable.created_at, filters.date_to));
    }

    // Build query with conditions
    const offset = (pagination.page - 1) * pagination.limit;
    
    let logs: ActivityLog[];
    if (conditions.length > 0) {
      logs = await db.select()
        .from(activityLogsTable)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(desc(activityLogsTable.created_at))
        .limit(pagination.limit)
        .offset(offset)
        .execute();
    } else {
      logs = await db.select()
        .from(activityLogsTable)
        .orderBy(desc(activityLogsTable.created_at))
        .limit(pagination.limit)
        .offset(offset)
        .execute();
    }

    // Count total records
    let totalResult: { count: number }[];
    if (conditions.length > 0) {
      totalResult = await db.select({ count: count() })
        .from(activityLogsTable)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .execute();
    } else {
      totalResult = await db.select({ count: count() })
        .from(activityLogsTable)
        .execute();
    }
    const total = totalResult[0].count;

    return { logs, total };
  } catch (error) {
    console.error('Get activity logs failed:', error);
    throw error;
  }
}

export async function exportActivityLogs(
  userId: number, 
  filters: ActivityLogFilter
): Promise<{ download_url: string }> {
  try {
    // Check if user is admin to determine access level
    const user = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .execute();

    if (user.length === 0) {
      throw new Error('User not found');
    }

    const isAdmin = user[0].is_admin;

    // Build conditions array
    const conditions: SQL<unknown>[] = [];

    // If not admin, only show user's own logs
    if (!isAdmin) {
      conditions.push(eq(activityLogsTable.user_id, userId));
    }

    // Apply filters (same as getActivityLogs)
    if (filters.user_id !== undefined) {
      conditions.push(eq(activityLogsTable.user_id, filters.user_id));
    }

    if (filters.action) {
      conditions.push(eq(activityLogsTable.action, filters.action));
    }

    if (filters.resource_type) {
      conditions.push(eq(activityLogsTable.resource_type, filters.resource_type));
    }

    if (filters.date_from) {
      conditions.push(gte(activityLogsTable.created_at, filters.date_from));
    }

    if (filters.date_to) {
      conditions.push(lte(activityLogsTable.created_at, filters.date_to));
    }

    // Execute query to get all matching logs
    let logs: ActivityLog[];
    if (conditions.length > 0) {
      logs = await db.select()
        .from(activityLogsTable)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(desc(activityLogsTable.created_at))
        .execute();
    } else {
      logs = await db.select()
        .from(activityLogsTable)
        .orderBy(desc(activityLogsTable.created_at))
        .execute();
    }

    // Log export activity
    await db.insert(activityLogsTable)
      .values({
        user_id: userId,
        action: 'export_activity_logs',
        resource_type: 'activity_log',
        resource_id: null,
        details: `Exported ${logs.length} activity log records`
      })
      .execute();

    // In a real implementation, you would:
    // 1. Generate CSV/Excel file from logs
    // 2. Upload to S3 or temporary storage
    // 3. Return download URL with expiration
    // For this example, we'll return a mock URL
    const exportId = Math.random().toString(36).substring(7);
    return {
      download_url: `https://api.blacklist-system.com/exports/activity-logs-${exportId}.csv`
    };
  } catch (error) {
    console.error('Export activity logs failed:', error);
    throw error;
  }
}

export async function getUserRole(userId: number): Promise<{ 
  role: 'admin' | 'user'; 
  permissions: string[] 
}> {
  try {
    // Find user by ID
    const user = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .execute();

    if (user.length === 0) {
      throw new Error('User not found');
    }

    const role = user[0].is_admin ? 'admin' : 'user';
    
    // Map role to permissions
    const adminPermissions = [
      'read_blacklist',
      'write_blacklist',
      'delete_blacklist',
      'read_all_profiles',
      'write_profile',
      'read_all_companies',
      'write_company',
      'read_all_activity_logs',
      'export_data',
      'manage_users',
      'system_settings'
    ];

    const userPermissions = [
      'read_blacklist',
      'write_blacklist',
      'read_profile',
      'write_profile',
      'read_company',
      'write_company',
      'read_activity_logs',
      'export_data'
    ];

    const permissions = role === 'admin' ? adminPermissions : userPermissions;

    return { role, permissions };
  } catch (error) {
    console.error('Get user role failed:', error);
    throw error;
  }
}