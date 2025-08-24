import { db } from '../db';
import { usersTable, companiesTable, sessionsTable, activityLogsTable } from '../db/schema';
import { 
  type CompleteRegistration, 
  type LoginInput, 
  type TwoFactorVerify,
  type User 
} from '../schema';
import { eq } from 'drizzle-orm';

export async function register(input: CompleteRegistration): Promise<{ user: User; success: boolean }> {
  try {
    // Check if email already exists
    const existingUsers = await db.select()
      .from(usersTable)
      .where(eq(usersTable.email, input.personal_info.email))
      .execute();
    
    if (existingUsers.length > 0) {
      throw new Error('Email already registered');
    }

    // Hash password (in production, use bcrypt)
    const password_hash = `hashed_${input.personal_info.password}`;

    // Create user
    const userResult = await db.insert(usersTable)
      .values({
        email: input.personal_info.email,
        password_hash,
        first_name: input.personal_info.first_name,
        last_name: input.personal_info.last_name,
        phone: input.personal_info.phone,
        is_admin: false,
        is_active: true,
        two_fa_enabled: false
      })
      .returning()
      .execute();

    const user = userResult[0];

    // Create associated company
    await db.insert(companiesTable)
      .values({
        user_id: user.id,
        name: input.company_info.name,
        legal_representative_name: input.company_info.legal_representative_name,
        phone: input.company_info.phone,
        address: input.company_info.address,
        city: input.company_info.city,
        association_membership: input.company_info.association_membership
      })
      .execute();

    // Log registration activity
    await db.insert(activityLogsTable)
      .values({
        user_id: user.id,
        action: 'user_registered',
        resource_type: 'user',
        resource_id: user.id,
        details: 'User account created with company information'
      })
      .execute();

    return { user, success: true };
  } catch (error) {
    console.error('Registration failed:', error);
    throw error;
  }
}

export async function login(input: LoginInput): Promise<{ user: User; token: string; requires_2fa: boolean }> {
  try {
    // Find user by email
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.email, input.email))
      .execute();

    if (users.length === 0) {
      throw new Error('Invalid credentials');
    }

    const user = users[0];

    // Verify password (in production, use bcrypt.compare)
    const expectedHash = `hashed_${input.password}`;
    if (user.password_hash !== expectedHash) {
      throw new Error('Invalid credentials');
    }

    // Check if user is active
    if (!user.is_active) {
      throw new Error('Account is deactivated');
    }

    // Check if 2FA is required
    if (user.two_fa_enabled) {
      return { user, token: '', requires_2fa: true };
    }

    // Generate session token (in production, use proper JWT)
    const token = `session_${user.id}_${Date.now()}`;

    // Create session record
    await db.insert(sessionsTable)
      .values({
        id: token,
        user_id: user.id,
        ip_address: '127.0.0.1', // In production, get from request
        user_agent: 'test-agent' // In production, get from request
      })
      .execute();

    // Update last login and remember token if requested
    const updates: any = {
      last_login: new Date(),
      updated_at: new Date()
    };

    if (input.remember_me) {
      updates.remember_token = `remember_${user.id}_${Date.now()}`;
    }

    await db.update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, user.id))
      .execute();

    // Log login activity
    await db.insert(activityLogsTable)
      .values({
        user_id: user.id,
        action: 'user_login',
        resource_type: 'user',
        resource_id: user.id,
        details: 'User logged in successfully'
      })
      .execute();

    // Get updated user data
    const updatedUsers = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .execute();

    return { user: updatedUsers[0], token, requires_2fa: false };
  } catch (error) {
    console.error('Login failed:', error);
    throw error;
  }
}

export async function verifyTwoFactor(input: TwoFactorVerify): Promise<{ user: User; token: string }> {
  try {
    // Get user with 2FA secret
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, input.user_id))
      .execute();

    if (users.length === 0) {
      throw new Error('User not found');
    }

    const user = users[0];

    if (!user.two_fa_enabled || !user.two_fa_secret) {
      throw new Error('2FA not enabled for this user');
    }

    // Verify 2FA code (in production, use authenticator.verify)
    const isValidCode = input.code === '123456'; // Mock validation
    if (!isValidCode) {
      throw new Error('Invalid 2FA code');
    }

    // Generate session token
    const token = `session_${user.id}_${Date.now()}`;

    // Create session record
    await db.insert(sessionsTable)
      .values({
        id: token,
        user_id: user.id,
        ip_address: '127.0.0.1',
        user_agent: 'test-agent'
      })
      .execute();

    // Update last login
    await db.update(usersTable)
      .set({
        last_login: new Date(),
        updated_at: new Date()
      })
      .where(eq(usersTable.id, user.id))
      .execute();

    // Log 2FA verification activity
    await db.insert(activityLogsTable)
      .values({
        user_id: user.id,
        action: 'two_factor_verified',
        resource_type: 'user',
        resource_id: user.id,
        details: '2FA code verified successfully'
      })
      .execute();

    // Get updated user data
    const updatedUsers = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .execute();

    return { user: updatedUsers[0], token };
  } catch (error) {
    console.error('2FA verification failed:', error);
    throw error;
  }
}

export async function logout(userId: number, sessionId: string): Promise<{ success: boolean }> {
  try {
    // Remove session from database
    await db.delete(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .execute();

    // Clear remember token
    await db.update(usersTable)
      .set({
        remember_token: null,
        updated_at: new Date()
      })
      .where(eq(usersTable.id, userId))
      .execute();

    // Log logout activity
    await db.insert(activityLogsTable)
      .values({
        user_id: userId,
        action: 'user_logout',
        resource_type: 'user',
        resource_id: userId,
        details: 'User logged out successfully'
      })
      .execute();

    return { success: true };
  } catch (error) {
    console.error('Logout failed:', error);
    throw error;
  }
}

export async function forgotPassword(email: string): Promise<{ success: boolean }> {
  try {
    // Find user by email
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .execute();

    if (users.length === 0) {
      // Don't reveal if email exists for security
      return { success: true };
    }

    const user = users[0];

    // Generate reset token (in production, use crypto.randomBytes)
    const resetToken = `reset_${user.id}_${Date.now()}`;

    // Store reset token (in production, store with expiration)
    await db.update(usersTable)
      .set({
        remember_token: resetToken, // Using remember_token field for simplicity
        updated_at: new Date()
      })
      .where(eq(usersTable.id, user.id))
      .execute();

    // Log password reset request
    await db.insert(activityLogsTable)
      .values({
        user_id: user.id,
        action: 'password_reset_requested',
        resource_type: 'user',
        resource_id: user.id,
        details: 'Password reset token generated'
      })
      .execute();

    // In production, send email with reset link
    console.log(`Password reset token for ${email}: ${resetToken}`);

    return { success: true };
  } catch (error) {
    console.error('Password reset request failed:', error);
    throw error;
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<{ success: boolean }> {
  try {
    // Find user by reset token (stored in remember_token field)
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.remember_token, token))
      .execute();

    if (users.length === 0) {
      throw new Error('Invalid or expired reset token');
    }

    const user = users[0];

    // Hash new password
    const newPasswordHash = `hashed_${newPassword}`;

    // Update password and clear reset token
    await db.update(usersTable)
      .set({
        password_hash: newPasswordHash,
        remember_token: null,
        updated_at: new Date()
      })
      .where(eq(usersTable.id, user.id))
      .execute();

    // Invalidate all existing sessions for security
    await db.delete(sessionsTable)
      .where(eq(sessionsTable.user_id, user.id))
      .execute();

    // Log password change
    await db.insert(activityLogsTable)
      .values({
        user_id: user.id,
        action: 'password_reset_completed',
        resource_type: 'user',
        resource_id: user.id,
        details: 'Password reset successfully completed'
      })
      .execute();

    return { success: true };
  } catch (error) {
    console.error('Password reset failed:', error);
    throw error;
  }
}