import { 
  serial, 
  text, 
  pgTable, 
  timestamp, 
  integer, 
  boolean, 
  pgEnum,
  json
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enum for blacklist entry status
export const blacklistStatusEnum = pgEnum('blacklist_status', ['active', 'inactive', 'pending', 'resolved']);

// Users table
export const usersTable = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  first_name: text('first_name').notNull(),
  last_name: text('last_name').notNull(),
  phone: text('phone').notNull(),
  is_admin: boolean('is_admin').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  two_fa_enabled: boolean('two_fa_enabled').default(false).notNull(),
  two_fa_secret: text('two_fa_secret'),
  remember_token: text('remember_token'),
  last_login: timestamp('last_login'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull()
});

// Companies table
export const companiesTable = pgTable('companies', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').references(() => usersTable.id).notNull(),
  name: text('name').notNull(),
  legal_representative_name: text('legal_representative_name').notNull(),
  phone: text('phone').notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  association_membership: text('association_membership'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull()
});

// Blacklist entries table
export const blacklistEntriesTable = pgTable('blacklist_entries', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').references(() => usersTable.id).notNull(),
  company_id: integer('company_id').references(() => companiesTable.id).notNull(),
  first_name: text('first_name').notNull(),
  last_name: text('last_name').notNull(),
  id_number: text('id_number').notNull(),
  phone: text('phone'),
  email: text('email'),
  face_image_url: text('face_image_url'),
  id_document_urls: json('id_document_urls').$type<string[]>().default([]).notNull(),
  blacklist_score: integer('blacklist_score').default(50).notNull(),
  reason: text('reason').notNull(),
  status: blacklistStatusEnum('status').default('active').notNull(),
  is_blacklisted: boolean('is_blacklisted').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull()
});

// Activity logs table
export const activityLogsTable = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').references(() => usersTable.id).notNull(),
  action: text('action').notNull(),
  resource_type: text('resource_type').notNull(),
  resource_id: integer('resource_id'),
  details: text('details'),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at').defaultNow().notNull()
});

// Sessions table
export const sessionsTable = pgTable('sessions', {
  id: text('id').primaryKey(),
  user_id: integer('user_id').references(() => usersTable.id).notNull(),
  ip_address: text('ip_address').notNull(),
  user_agent: text('user_agent').notNull(),
  last_activity: timestamp('last_activity').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull()
});

// Relations
export const usersRelations = relations(usersTable, ({ one, many }) => ({
  company: one(companiesTable),
  blacklistEntries: many(blacklistEntriesTable),
  activityLogs: many(activityLogsTable),
  sessions: many(sessionsTable)
}));

export const companiesRelations = relations(companiesTable, ({ one, many }) => ({
  user: one(usersTable, {
    fields: [companiesTable.user_id],
    references: [usersTable.id]
  }),
  blacklistEntries: many(blacklistEntriesTable)
}));

export const blacklistEntriesRelations = relations(blacklistEntriesTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [blacklistEntriesTable.user_id],
    references: [usersTable.id]
  }),
  company: one(companiesTable, {
    fields: [blacklistEntriesTable.company_id],
    references: [companiesTable.id]
  })
}));

export const activityLogsRelations = relations(activityLogsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [activityLogsTable.user_id],
    references: [usersTable.id]
  })
}));

export const sessionsRelations = relations(sessionsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [sessionsTable.user_id],
    references: [usersTable.id]
  })
}));

// TypeScript types for table schemas
export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;

export type Company = typeof companiesTable.$inferSelect;
export type NewCompany = typeof companiesTable.$inferInsert;

export type BlacklistEntry = typeof blacklistEntriesTable.$inferSelect;
export type NewBlacklistEntry = typeof blacklistEntriesTable.$inferInsert;

export type ActivityLog = typeof activityLogsTable.$inferSelect;
export type NewActivityLog = typeof activityLogsTable.$inferInsert;

export type Session = typeof sessionsTable.$inferSelect;
export type NewSession = typeof sessionsTable.$inferInsert;

// Export all tables and relations for proper query building
export const tables = {
  users: usersTable,
  companies: companiesTable,
  blacklistEntries: blacklistEntriesTable,
  activityLogs: activityLogsTable,
  sessions: sessionsTable
};

export const tableRelations = {
  usersRelations,
  companiesRelations,
  blacklistEntriesRelations,
  activityLogsRelations,
  sessionsRelations
};