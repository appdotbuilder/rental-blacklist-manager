import { initTRPC } from '@trpc/server';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import 'dotenv/config';
import cors from 'cors';
import superjson from 'superjson';
import { z } from 'zod';

// Import schemas
import {
  completeRegistrationSchema,
  loginSchema,
  twoFactorVerifySchema,
  createBlacklistEntrySchema,
  updateBlacklistEntrySchema,
  searchSchema,
  updateProfileSchema,
  updateCompanySchema,
  changePasswordSchema,
  toggleTwoFactorSchema,
  paginationSchema,
  blacklistFilterSchema,
  activityLogFilterSchema
} from './schema';

// Import handlers
import { 
  register, 
  login, 
  verifyTwoFactor, 
  logout, 
  forgotPassword, 
  resetPassword 
} from './handlers/auth';
import { 
  getDashboardAnalytics, 
  getRecentActivity 
} from './handlers/dashboard';
import {
  createBlacklistEntry,
  getBlacklistEntries,
  getBlacklistEntry,
  updateBlacklistEntry,
  deleteBlacklistEntry,
  toggleBlacklistStatus
} from './handlers/blacklist';
import {
  searchBlacklistEntries,
  searchByFaceImage,
  searchByText,
  getSearchSuggestions
} from './handlers/search';
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
} from './handlers/settings';
import {
  uploadToS3,
  uploadFaceImage,
  uploadIdDocument,
  deleteFromS3,
  generatePresignedUrl
} from './handlers/upload';

const t = initTRPC.create({
  transformer: superjson,
});

const publicProcedure = t.procedure;
const router = t.router;

const appRouter = router({
  // Health check
  healthcheck: publicProcedure.query(() => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }),

  // Authentication routes
  auth: router({
    register: publicProcedure
      .input(completeRegistrationSchema)
      .mutation(({ input }) => register(input)),
    
    login: publicProcedure
      .input(loginSchema)
      .mutation(({ input }) => login(input)),
    
    verifyTwoFactor: publicProcedure
      .input(twoFactorVerifySchema)
      .mutation(({ input }) => verifyTwoFactor(input)),
    
    logout: publicProcedure
      .input(z.object({ userId: z.number(), sessionId: z.string() }))
      .mutation(({ input }) => logout(input.userId, input.sessionId)),
    
    forgotPassword: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(({ input }) => forgotPassword(input.email)),
    
    resetPassword: publicProcedure
      .input(z.object({ token: z.string(), newPassword: z.string() }))
      .mutation(({ input }) => resetPassword(input.token, input.newPassword))
  }),

  // Dashboard routes
  dashboard: router({
    getAnalytics: publicProcedure
      .input(z.object({ userId: z.number() }))
      .query(({ input }) => getDashboardAnalytics(input.userId)),
    
    getRecentActivity: publicProcedure
      .input(z.object({ userId: z.number(), limit: z.number().optional() }))
      .query(({ input }) => getRecentActivity(input.userId, input.limit))
  }),

  // Blacklist management routes
  blacklist: router({
    create: publicProcedure
      .input(z.object({ userId: z.number(), entry: createBlacklistEntrySchema }))
      .mutation(({ input }) => createBlacklistEntry(input.userId, input.entry)),
    
    getAll: publicProcedure
      .input(z.object({ 
        userId: z.number(), 
        filters: blacklistFilterSchema, 
        pagination: paginationSchema 
      }))
      .query(({ input }) => getBlacklistEntries(input.userId, input.filters, input.pagination)),
    
    getById: publicProcedure
      .input(z.object({ userId: z.number(), entryId: z.number() }))
      .query(({ input }) => getBlacklistEntry(input.userId, input.entryId)),
    
    update: publicProcedure
      .input(z.object({ userId: z.number(), entry: updateBlacklistEntrySchema }))
      .mutation(({ input }) => updateBlacklistEntry(input.userId, input.entry)),
    
    delete: publicProcedure
      .input(z.object({ userId: z.number(), entryId: z.number() }))
      .mutation(({ input }) => deleteBlacklistEntry(input.userId, input.entryId)),
    
    toggleStatus: publicProcedure
      .input(z.object({ userId: z.number(), entryId: z.number(), isBlacklisted: z.boolean() }))
      .mutation(({ input }) => toggleBlacklistStatus(input.userId, input.entryId, input.isBlacklisted))
  }),

  // Search routes
  search: router({
    entries: publicProcedure
      .input(z.object({ userId: z.number(), search: searchSchema }))
      .query(({ input }) => searchBlacklistEntries(input.userId, input.search)),
    
    byFace: publicProcedure
      .input(z.object({ faceImageBase64: z.string() }))
      .query(({ input }) => searchByFaceImage(input.faceImageBase64)),
    
    byText: publicProcedure
      .input(z.object({ query: z.string(), companyId: z.number().optional() }))
      .query(({ input }) => searchByText(input.query, input.companyId)),
    
    suggestions: publicProcedure
      .input(z.object({ userId: z.number(), query: z.string() }))
      .query(({ input }) => getSearchSuggestions(input.userId, input.query))
  }),

  // Settings routes
  settings: router({
    updateProfile: publicProcedure
      .input(z.object({ userId: z.number(), profile: updateProfileSchema }))
      .mutation(({ input }) => updateProfile(input.userId, input.profile)),
    
    updateCompany: publicProcedure
      .input(z.object({ userId: z.number(), company: updateCompanySchema }))
      .mutation(({ input }) => updateCompany(input.userId, input.company)),
    
    changePassword: publicProcedure
      .input(z.object({ userId: z.number(), passwords: changePasswordSchema }))
      .mutation(({ input }) => changePassword(input.userId, input.passwords)),
    
    toggleTwoFactor: publicProcedure
      .input(z.object({ userId: z.number(), settings: toggleTwoFactorSchema }))
      .mutation(({ input }) => toggleTwoFactor(input.userId, input.settings)),
    
    getSessions: publicProcedure
      .input(z.object({ userId: z.number() }))
      .query(({ input }) => getUserSessions(input.userId)),
    
    terminateSession: publicProcedure
      .input(z.object({ userId: z.number(), sessionId: z.string() }))
      .mutation(({ input }) => terminateSession(input.userId, input.sessionId)),
    
    terminateAllSessions: publicProcedure
      .input(z.object({ userId: z.number(), currentSessionId: z.string() }))
      .mutation(({ input }) => terminateAllSessions(input.userId, input.currentSessionId)),
    
    getActivityLogs: publicProcedure
      .input(z.object({ 
        userId: z.number(), 
        filters: activityLogFilterSchema, 
        pagination: paginationSchema 
      }))
      .query(({ input }) => getActivityLogs(input.userId, input.filters, input.pagination)),
    
    exportActivityLogs: publicProcedure
      .input(z.object({ userId: z.number(), filters: activityLogFilterSchema }))
      .mutation(({ input }) => exportActivityLogs(input.userId, input.filters)),
    
    getUserRole: publicProcedure
      .input(z.object({ userId: z.number() }))
      .query(({ input }) => getUserRole(input.userId))
  }),

  // File upload routes
  upload: router({
    toS3: publicProcedure
      .input(z.object({ 
        fileBuffer: z.string(), // Base64 encoded file
        fileName: z.string(),
        contentType: z.string(),
        userId: z.number()
      }))
      .mutation(({ input }) => {
        const buffer = Buffer.from(input.fileBuffer, 'base64');
        return uploadToS3(buffer, input.fileName, input.contentType, input.userId);
      }),
    
    faceImage: publicProcedure
      .input(z.object({ 
        imageBuffer: z.string(), // Base64 encoded image
        userId: z.number(),
        entryId: z.number().optional()
      }))
      .mutation(({ input }) => {
        const buffer = Buffer.from(input.imageBuffer, 'base64');
        return uploadFaceImage(buffer, input.userId, input.entryId);
      }),
    
    idDocument: publicProcedure
      .input(z.object({ 
        documentBuffer: z.string(), // Base64 encoded document
        documentType: z.enum(['id_card', 'passport', 'drivers_license']),
        userId: z.number(),
        entryId: z.number().optional()
      }))
      .mutation(({ input }) => {
        const buffer = Buffer.from(input.documentBuffer, 'base64');
        return uploadIdDocument(buffer, input.documentType, input.userId, input.entryId);
      }),
    
    delete: publicProcedure
      .input(z.object({ key: z.string(), userId: z.number() }))
      .mutation(({ input }) => deleteFromS3(input.key, input.userId)),
    
    getPresignedUrl: publicProcedure
      .input(z.object({ 
        key: z.string(), 
        userId: z.number(),
        expirationSeconds: z.number().optional()
      }))
      .query(({ input }) => generatePresignedUrl(input.key, input.userId, input.expirationSeconds))
  })
});

export type AppRouter = typeof appRouter;

async function start() {
  const port = process.env['SERVER_PORT'] || 2022;
  const server = createHTTPServer({
    middleware: (req, res, next) => {
      cors()(req, res, next);
    },
    router: appRouter,
    createContext() {
      return {};
    },
  });
  server.listen(port);
  console.log(`TRPC server listening at port: ${port}`);
}

start();