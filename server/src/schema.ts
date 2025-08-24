import { z } from 'zod';

// User schema
export const userSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  password_hash: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  phone: z.string(),
  is_admin: z.boolean(),
  is_active: z.boolean(),
  two_fa_enabled: z.boolean(),
  two_fa_secret: z.string().nullable(),
  remember_token: z.string().nullable(),
  last_login: z.coerce.date().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date()
});

export type User = z.infer<typeof userSchema>;

// Company schema
export const companySchema = z.object({
  id: z.number(),
  user_id: z.number(),
  name: z.string(),
  legal_representative_name: z.string(),
  phone: z.string(),
  address: z.string(),
  city: z.string(),
  association_membership: z.string().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date()
});

export type Company = z.infer<typeof companySchema>;

// Blacklist entry status enum
export const blacklistStatusEnum = z.enum(['active', 'inactive', 'pending', 'resolved']);
export type BlacklistStatus = z.infer<typeof blacklistStatusEnum>;

// Blacklist entry schema
export const blacklistEntrySchema = z.object({
  id: z.number(),
  user_id: z.number(),
  company_id: z.number(),
  first_name: z.string(),
  last_name: z.string(),
  id_number: z.string(),
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  face_image_url: z.string().nullable(),
  id_document_urls: z.array(z.string()),
  blacklist_score: z.number().min(0).max(100),
  reason: z.string(),
  status: blacklistStatusEnum,
  is_blacklisted: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date()
});

export type BlacklistEntry = z.infer<typeof blacklistEntrySchema>;

// Activity log schema
export const activityLogSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.number().nullable(),
  details: z.string().nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: z.coerce.date()
});

export type ActivityLog = z.infer<typeof activityLogSchema>;

// Session schema
export const sessionSchema = z.object({
  id: z.string(),
  user_id: z.number(),
  ip_address: z.string(),
  user_agent: z.string(),
  last_activity: z.coerce.date(),
  created_at: z.coerce.date()
});

export type Session = z.infer<typeof sessionSchema>;

// Input schemas for registration
export const registerPersonalInfoSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().min(10, 'Valid phone number is required'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export type RegisterPersonalInfo = z.infer<typeof registerPersonalInfoSchema>;

export const registerCompanyInfoSchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  legal_representative_name: z.string().min(1, 'Legal representative name is required'),
  phone: z.string().min(10, 'Valid phone number is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  association_membership: z.string().nullable()
});

export type RegisterCompanyInfo = z.infer<typeof registerCompanyInfoSchema>;

export const completeRegistrationSchema = z.object({
  personal_info: registerPersonalInfoSchema,
  company_info: registerCompanyInfoSchema
});

export type CompleteRegistration = z.infer<typeof completeRegistrationSchema>;

// Input schemas for login
export const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
  remember_me: z.boolean().optional().default(false)
});

export type LoginInput = z.infer<typeof loginSchema>;

export const twoFactorVerifySchema = z.object({
  user_id: z.number(),
  code: z.string().length(6, '2FA code must be 6 digits')
});

export type TwoFactorVerify = z.infer<typeof twoFactorVerifySchema>;

// Input schemas for blacklist entries
export const createBlacklistEntrySchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  id_number: z.string().min(1, 'ID number is required'),
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  face_image_url: z.string().nullable(),
  id_document_urls: z.array(z.string()).default([]),
  reason: z.string().min(1, 'Reason is required'),
  is_blacklisted: z.boolean().default(true)
});

export type CreateBlacklistEntry = z.infer<typeof createBlacklistEntrySchema>;

export const updateBlacklistEntrySchema = z.object({
  id: z.number(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  id_number: z.string().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  face_image_url: z.string().nullable().optional(),
  id_document_urls: z.array(z.string()).optional(),
  reason: z.string().optional(),
  status: blacklistStatusEnum.optional(),
  is_blacklisted: z.boolean().optional()
});

export type UpdateBlacklistEntry = z.infer<typeof updateBlacklistEntrySchema>;

// Search schemas
export const searchSchema = z.object({
  query: z.string().optional(),
  face_image: z.string().optional(), // Base64 encoded image for face search
  company_id: z.number().optional(),
  status: blacklistStatusEnum.optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0)
});

export type SearchInput = z.infer<typeof searchSchema>;

// Dashboard analytics schema
export const dashboardAnalyticsSchema = z.object({
  total_entries: z.number(),
  active_blacklisted: z.number(),
  pending_entries: z.number(),
  resolved_entries: z.number(),
  risk_score_distribution: z.array(z.object({
    range: z.string(),
    count: z.number()
  })),
  recent_activities: z.array(z.object({
    id: z.number(),
    action: z.string(),
    resource_type: z.string(),
    user_name: z.string(),
    created_at: z.coerce.date()
  }))
});

export type DashboardAnalytics = z.infer<typeof dashboardAnalyticsSchema>;

// Settings update schemas
export const updateProfileSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional()
});

export type UpdateProfile = z.infer<typeof updateProfileSchema>;

export const updateCompanySchema = z.object({
  name: z.string().optional(),
  legal_representative_name: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  association_membership: z.string().nullable().optional()
});

export type UpdateCompany = z.infer<typeof updateCompanySchema>;

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
  confirm_password: z.string().min(1, 'Password confirmation is required')
}).refine(data => data.new_password === data.confirm_password, {
  message: "Passwords don't match",
  path: ["confirm_password"]
});

export type ChangePassword = z.infer<typeof changePasswordSchema>;

export const toggleTwoFactorSchema = z.object({
  enable: z.boolean(),
  code: z.string().optional() // Required when enabling 2FA
});

export type ToggleTwoFactor = z.infer<typeof toggleTwoFactorSchema>;

// Pagination and filtering
export const paginationSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20)
});

export type Pagination = z.infer<typeof paginationSchema>;

export const blacklistFilterSchema = z.object({
  status: blacklistStatusEnum.optional(),
  company_id: z.number().optional(),
  search: z.string().optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
  min_score: z.number().min(0).max(100).optional(),
  max_score: z.number().min(0).max(100).optional()
});

export type BlacklistFilter = z.infer<typeof blacklistFilterSchema>;

export const activityLogFilterSchema = z.object({
  user_id: z.number().optional(),
  action: z.string().optional(),
  resource_type: z.string().optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional()
});

export type ActivityLogFilter = z.infer<typeof activityLogFilterSchema>;