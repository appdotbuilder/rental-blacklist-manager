import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, companiesTable, sessionsTable, activityLogsTable } from '../db/schema';
import { 
  type CompleteRegistration,
  type LoginInput,
  type TwoFactorVerify
} from '../schema';
import { 
  register, 
  login, 
  verifyTwoFactor, 
  logout, 
  forgotPassword, 
  resetPassword 
} from '../handlers/auth';
import { eq, and } from 'drizzle-orm';

// Test data
const testRegistration: CompleteRegistration = {
  personal_info: {
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@example.com',
    phone: '+1234567890',
    password: 'SecurePass123!'
  },
  company_info: {
    name: 'Test Company Ltd',
    legal_representative_name: 'John Doe',
    phone: '+1234567891',
    address: '123 Business St',
    city: 'Business City',
    association_membership: 'Chamber of Commerce'
  }
};

const testLogin: LoginInput = {
  email: 'john.doe@example.com',
  password: 'SecurePass123!',
  remember_me: false
};

describe('Auth Handlers', () => {
  beforeEach(createDB);
  afterEach(resetDB);

  describe('register', () => {
    it('should successfully register a new user with company', async () => {
      const result = await register(testRegistration);

      expect(result.success).toBe(true);
      expect(result.user.email).toBe(testRegistration.personal_info.email);
      expect(result.user.first_name).toBe(testRegistration.personal_info.first_name);
      expect(result.user.last_name).toBe(testRegistration.personal_info.last_name);
      expect(result.user.phone).toBe(testRegistration.personal_info.phone);
      expect(result.user.is_admin).toBe(false);
      expect(result.user.is_active).toBe(true);
      expect(result.user.two_fa_enabled).toBe(false);
      expect(result.user.id).toBeDefined();
      expect(result.user.created_at).toBeInstanceOf(Date);
    });

    it('should create user record in database', async () => {
      const result = await register(testRegistration);

      const users = await db.select()
        .from(usersTable)
        .where(eq(usersTable.id, result.user.id))
        .execute();

      expect(users).toHaveLength(1);
      expect(users[0].email).toBe(testRegistration.personal_info.email);
      expect(users[0].password_hash).toBe(`hashed_${testRegistration.personal_info.password}`);
    });

    it('should create company record for user', async () => {
      const result = await register(testRegistration);

      const companies = await db.select()
        .from(companiesTable)
        .where(eq(companiesTable.user_id, result.user.id))
        .execute();

      expect(companies).toHaveLength(1);
      expect(companies[0].name).toBe(testRegistration.company_info.name);
      expect(companies[0].legal_representative_name).toBe(testRegistration.company_info.legal_representative_name);
      expect(companies[0].address).toBe(testRegistration.company_info.address);
      expect(companies[0].city).toBe(testRegistration.company_info.city);
      expect(companies[0].association_membership).toBe(testRegistration.company_info.association_membership);
    });

    it('should log registration activity', async () => {
      const result = await register(testRegistration);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(and(
          eq(activityLogsTable.user_id, result.user.id),
          eq(activityLogsTable.action, 'user_registered')
        ))
        .execute();

      expect(activities).toHaveLength(1);
      expect(activities[0].resource_type).toBe('user');
      expect(activities[0].resource_id).toBe(result.user.id);
    });

    it('should reject duplicate email registration', async () => {
      await register(testRegistration);

      await expect(register(testRegistration)).rejects.toThrow(/email already registered/i);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      // Create a test user for login tests
      await register(testRegistration);
    });

    it('should successfully login with valid credentials', async () => {
      const result = await login(testLogin);

      expect(result.user.email).toBe(testLogin.email);
      expect(result.token).toMatch(/^session_\d+_\d+$/);
      expect(result.requires_2fa).toBe(false);
      expect(result.user.last_login).toBeInstanceOf(Date);
    });

    it('should create session record', async () => {
      const result = await login(testLogin);

      const sessions = await db.select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, result.token))
        .execute();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].user_id).toBe(result.user.id);
      expect(sessions[0].ip_address).toBe('127.0.0.1');
    });

    it('should set remember token when remember_me is true', async () => {
      const loginWithRemember: LoginInput = {
        ...testLogin,
        remember_me: true
      };

      const result = await login(loginWithRemember);

      const users = await db.select()
        .from(usersTable)
        .where(eq(usersTable.id, result.user.id))
        .execute();

      expect(users[0].remember_token).toMatch(/^remember_\d+_\d+$/);
    });

    it('should require 2FA when enabled', async () => {
      // First get user ID
      const loginResult = await login(testLogin);
      
      // Enable 2FA for user
      await db.update(usersTable)
        .set({
          two_fa_enabled: true,
          two_fa_secret: 'test_secret_123'
        })
        .where(eq(usersTable.id, loginResult.user.id))
        .execute();

      const result = await login(testLogin);

      expect(result.requires_2fa).toBe(true);
      expect(result.token).toBe('');
    });

    it('should reject invalid email', async () => {
      const invalidLogin = {
        ...testLogin,
        email: 'nonexistent@example.com'
      };

      await expect(login(invalidLogin)).rejects.toThrow(/invalid credentials/i);
    });

    it('should reject invalid password', async () => {
      const invalidLogin = {
        ...testLogin,
        password: 'wrongpassword'
      };

      await expect(login(invalidLogin)).rejects.toThrow(/invalid credentials/i);
    });

    it('should reject inactive user', async () => {
      const loginResult = await login(testLogin);
      
      // Deactivate user
      await db.update(usersTable)
        .set({ is_active: false })
        .where(eq(usersTable.id, loginResult.user.id))
        .execute();

      await expect(login(testLogin)).rejects.toThrow(/account is deactivated/i);
    });

    it('should log login activity', async () => {
      const result = await login(testLogin);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(and(
          eq(activityLogsTable.user_id, result.user.id),
          eq(activityLogsTable.action, 'user_login')
        ))
        .execute();

      expect(activities).toHaveLength(1);
    });
  });

  describe('verifyTwoFactor', () => {
    let userId: number;

    beforeEach(async () => {
      const regResult = await register(testRegistration);
      userId = regResult.user.id;

      // Enable 2FA
      await db.update(usersTable)
        .set({
          two_fa_enabled: true,
          two_fa_secret: 'test_secret_123'
        })
        .where(eq(usersTable.id, userId))
        .execute();
    });

    it('should verify 2FA and complete login', async () => {
      const twoFactorInput: TwoFactorVerify = {
        user_id: userId,
        code: '123456' // Mock valid code
      };

      const result = await verifyTwoFactor(twoFactorInput);

      expect(result.user.id).toBe(userId);
      expect(result.token).toMatch(/^session_\d+_\d+$/);
      expect(result.user.last_login).toBeInstanceOf(Date);
    });

    it('should create session after 2FA verification', async () => {
      const twoFactorInput: TwoFactorVerify = {
        user_id: userId,
        code: '123456'
      };

      const result = await verifyTwoFactor(twoFactorInput);

      const sessions = await db.select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, result.token))
        .execute();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].user_id).toBe(userId);
    });

    it('should reject invalid 2FA code', async () => {
      const twoFactorInput: TwoFactorVerify = {
        user_id: userId,
        code: '000000' // Invalid code
      };

      await expect(verifyTwoFactor(twoFactorInput)).rejects.toThrow(/invalid 2fa code/i);
    });

    it('should reject user without 2FA enabled', async () => {
      // Disable 2FA
      await db.update(usersTable)
        .set({ two_fa_enabled: false })
        .where(eq(usersTable.id, userId))
        .execute();

      const twoFactorInput: TwoFactorVerify = {
        user_id: userId,
        code: '123456'
      };

      await expect(verifyTwoFactor(twoFactorInput)).rejects.toThrow(/2fa not enabled/i);
    });

    it('should log 2FA verification activity', async () => {
      const twoFactorInput: TwoFactorVerify = {
        user_id: userId,
        code: '123456'
      };

      await verifyTwoFactor(twoFactorInput);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(and(
          eq(activityLogsTable.user_id, userId),
          eq(activityLogsTable.action, 'two_factor_verified')
        ))
        .execute();

      expect(activities).toHaveLength(1);
    });
  });

  describe('logout', () => {
    let userId: number;
    let sessionId: string;

    beforeEach(async () => {
      const regResult = await register(testRegistration);
      const loginResult = await login(testLogin);
      userId = regResult.user.id;
      sessionId = loginResult.token;
    });

    it('should successfully logout user', async () => {
      const result = await logout(userId, sessionId);

      expect(result.success).toBe(true);
    });

    it('should remove session from database', async () => {
      await logout(userId, sessionId);

      const sessions = await db.select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .execute();

      expect(sessions).toHaveLength(0);
    });

    it('should clear remember token', async () => {
      // Set remember token first
      await db.update(usersTable)
        .set({ remember_token: 'test_token' })
        .where(eq(usersTable.id, userId))
        .execute();

      await logout(userId, sessionId);

      const users = await db.select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .execute();

      expect(users[0].remember_token).toBeNull();
    });

    it('should log logout activity', async () => {
      await logout(userId, sessionId);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(and(
          eq(activityLogsTable.user_id, userId),
          eq(activityLogsTable.action, 'user_logout')
        ))
        .execute();

      expect(activities).toHaveLength(1);
    });
  });

  describe('forgotPassword', () => {
    beforeEach(async () => {
      await register(testRegistration);
    });

    it('should generate reset token for valid email', async () => {
      const result = await forgotPassword(testRegistration.personal_info.email);

      expect(result.success).toBe(true);

      const users = await db.select()
        .from(usersTable)
        .where(eq(usersTable.email, testRegistration.personal_info.email))
        .execute();

      expect(users[0].remember_token).toMatch(/^reset_\d+_\d+$/);
    });

    it('should log password reset request', async () => {
      await forgotPassword(testRegistration.personal_info.email);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.action, 'password_reset_requested'))
        .execute();

      expect(activities).toHaveLength(1);
    });

    it('should return success for non-existent email', async () => {
      // Security: don't reveal if email exists
      const result = await forgotPassword('nonexistent@example.com');

      expect(result.success).toBe(true);
    });
  });

  describe('resetPassword', () => {
    let resetToken: string;

    beforeEach(async () => {
      await register(testRegistration);
      await forgotPassword(testRegistration.personal_info.email);

      const users = await db.select()
        .from(usersTable)
        .where(eq(usersTable.email, testRegistration.personal_info.email))
        .execute();

      resetToken = users[0].remember_token!;
    });

    it('should successfully reset password with valid token', async () => {
      const newPassword = 'NewSecurePass123!';
      const result = await resetPassword(resetToken, newPassword);

      expect(result.success).toBe(true);

      const users = await db.select()
        .from(usersTable)
        .where(eq(usersTable.remember_token, resetToken))
        .execute();

      expect(users).toHaveLength(0); // Token should be cleared
    });

    it('should update password hash', async () => {
      const newPassword = 'NewSecurePass123!';
      await resetPassword(resetToken, newPassword);

      const users = await db.select()
        .from(usersTable)
        .where(eq(usersTable.email, testRegistration.personal_info.email))
        .execute();

      expect(users[0].password_hash).toBe(`hashed_${newPassword}`);
      expect(users[0].remember_token).toBeNull();
    });

    it('should invalidate all user sessions', async () => {
      // Create a session first
      await db.insert(sessionsTable)
        .values({
          id: 'test_session',
          user_id: 1,
          ip_address: '127.0.0.1',
          user_agent: 'test'
        })
        .execute();

      await resetPassword(resetToken, 'NewPassword123!');

      const sessions = await db.select()
        .from(sessionsTable)
        .execute();

      expect(sessions).toHaveLength(0);
    });

    it('should reject invalid reset token', async () => {
      await expect(resetPassword('invalid_token', 'NewPassword123!'))
        .rejects.toThrow(/invalid or expired reset token/i);
    });

    it('should log password reset completion', async () => {
      await resetPassword(resetToken, 'NewPassword123!');

      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.action, 'password_reset_completed'))
        .execute();

      expect(activities).toHaveLength(1);
    });
  });
});