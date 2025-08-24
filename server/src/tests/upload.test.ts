import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, activityLogsTable } from '../db/schema';
import { 
  uploadToS3, 
  uploadFaceImage, 
  uploadIdDocument, 
  deleteFromS3, 
  generatePresignedUrl 
} from '../handlers/upload';
import { eq } from 'drizzle-orm';

// Test data
const testUserId = 1;
const validImageBuffer = Buffer.from('fake-image-data-with-sufficient-size-for-face-detection-must-be-at-least-30-bytes');
const validDocumentBuffer = Buffer.from('fake-document-data-with-sufficient-size-for-testing-purposes');
const smallBuffer = Buffer.from('small'); // Less than 30 bytes - no face detected
const emptyBuffer = Buffer.alloc(0);

describe('Upload Handlers', () => {
  beforeEach(createDB);
  afterEach(resetDB);

  beforeEach(async () => {
    // Create test user
    await db.insert(usersTable).values({
      email: 'test@example.com',
      password_hash: 'hashed_password',
      first_name: 'Test',
      last_name: 'User',
      phone: '1234567890',
      is_admin: false,
      is_active: true,
      two_fa_enabled: false
    }).execute();
  });

  describe('uploadToS3', () => {
    it('should upload file successfully', async () => {
      const result = await uploadToS3(
        validDocumentBuffer,
        'test-document.pdf',
        'application/pdf',
        testUserId
      );

      expect(result.url).toContain('https://');
      expect(result.url).toContain('blacklist-system-bucket');
      expect(result.key).toStartWith(`uploads/${testUserId}/`);
      expect(result.key).toContain('test-document.pdf');
    });

    it('should log upload activity', async () => {
      await uploadToS3(
        validDocumentBuffer,
        'test-file.jpg',
        'image/jpeg',
        testUserId
      );

      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(activities).toHaveLength(1);
      expect(activities[0].action).toBe('file_upload');
      expect(activities[0].resource_type).toBe('file');
      expect(activities[0].details).toContain('test-file.jpg');
    });

    it('should reject empty file buffer', async () => {
      await expect(uploadToS3(
        emptyBuffer,
        'test.jpg',
        'image/jpeg',
        testUserId
      )).rejects.toThrow(/file buffer is required/i);
    });

    it('should reject invalid file name', async () => {
      await expect(uploadToS3(
        validDocumentBuffer,
        '',
        'image/jpeg',
        testUserId
      )).rejects.toThrow(/file name is required/i);

      await expect(uploadToS3(
        validDocumentBuffer,
        '   ',
        'image/jpeg',
        testUserId
      )).rejects.toThrow(/file name is required/i);
    });

    it('should reject invalid content type', async () => {
      await expect(uploadToS3(
        validDocumentBuffer,
        'test.txt',
        'text/plain',
        testUserId
      )).rejects.toThrow(/invalid file type/i);
    });

    it('should reject invalid user ID', async () => {
      await expect(uploadToS3(
        validDocumentBuffer,
        'test.jpg',
        'image/jpeg',
        0
      )).rejects.toThrow(/valid user id is required/i);

      await expect(uploadToS3(
        validDocumentBuffer,
        'test.jpg',
        'image/jpeg',
        -1
      )).rejects.toThrow(/valid user id is required/i);
    });

    it('should reject oversized files', async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB

      await expect(uploadToS3(
        largeBuffer,
        'large-file.jpg',
        'image/jpeg',
        testUserId
      )).rejects.toThrow(/file size exceeds maximum/i);
    });

    it('should accept valid image types', async () => {
      const imageTypes = [
        { contentType: 'image/jpeg', extension: 'jpg' },
        { contentType: 'image/png', extension: 'png' },
        { contentType: 'application/pdf', extension: 'pdf' }
      ];

      for (const { contentType, extension } of imageTypes) {
        const result = await uploadToS3(
          validDocumentBuffer,
          `test.${extension}`,
          contentType,
          testUserId
        );

        expect(result.url).toContain('https://');
        expect(result.key).toContain(`.${extension}`);
      }
    });
  });

  describe('uploadFaceImage', () => {
    it('should upload face image successfully', async () => {
      const result = await uploadFaceImage(validImageBuffer, testUserId);

      expect(result.url).toContain('https://');
      expect(result.key).toStartWith(`faces/${testUserId}/`);
      expect(result.face_detected).toBe(true);
    });

    it('should upload face image with entry ID', async () => {
      const entryId = 123;
      const result = await uploadFaceImage(validImageBuffer, testUserId, entryId);

      expect(result.face_detected).toBe(true);

      // Check activity log includes entry ID
      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(activities[0].details).toContain(`entry ${entryId}`);
    });

    it('should log face image upload activity', async () => {
      await uploadFaceImage(validImageBuffer, testUserId);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(activities).toHaveLength(1);
      expect(activities[0].action).toBe('face_image_upload');
      expect(activities[0].details).toContain('confidence');
    });

    it('should reject empty image buffer', async () => {
      await expect(uploadFaceImage(
        emptyBuffer,
        testUserId
      )).rejects.toThrow(/image buffer is required/i);
    });

    it('should reject invalid user ID', async () => {
      await expect(uploadFaceImage(
        validImageBuffer,
        0
      )).rejects.toThrow(/valid user id is required/i);
    });

    it('should reject images without faces', async () => {
      // Small buffer simulates no face detected
      await expect(uploadFaceImage(
        smallBuffer,
        testUserId
      )).rejects.toThrow(/no face detected/i);
    });

    it('should reject oversized images', async () => {
      const largeImageBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB

      await expect(uploadFaceImage(
        largeImageBuffer,
        testUserId
      )).rejects.toThrow(/file size exceeds maximum/i);
    });

    it('should handle face detection edge cases', async () => {
      // Test with valid buffer that should pass face detection
      const result = await uploadFaceImage(validImageBuffer, testUserId);
      expect(result.face_detected).toBe(true);
      expect(typeof result.url).toBe('string');
      expect(typeof result.key).toBe('string');
    });
  });

  describe('uploadIdDocument', () => {
    const documentTypes = ['id_card', 'passport', 'drivers_license'] as const;

    it('should upload ID document successfully', async () => {
      for (const docType of documentTypes) {
        const result = await uploadIdDocument(
          validDocumentBuffer,
          docType,
          testUserId
        );

        expect(result.url).toContain('https://');
        expect(result.key).toStartWith(`documents/${testUserId}/`);
        expect(result.key).toContain(`${docType}-document.jpg`);
        expect(result.extracted_data).toBeDefined();
        expect(result.extracted_data.id_number).toBeDefined();
        expect(result.extracted_data.name).toBeDefined();
        expect(result.extracted_data.date_of_birth).toBeDefined();
      }
    });

    it('should upload document with entry ID', async () => {
      const entryId = 456;
      const result = await uploadIdDocument(
        validDocumentBuffer,
        'passport',
        testUserId,
        entryId
      );

      expect(result.extracted_data).toBeDefined();

      // Check activity log includes entry ID
      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(activities[0].details).toContain(`entry ${entryId}`);
    });

    it('should extract different data for different document types', async () => {
      const passportResult = await uploadIdDocument(
        validDocumentBuffer,
        'passport',
        testUserId
      );
      expect(passportResult.extracted_data.passport_number).toBeDefined();
      expect(passportResult.extracted_data.nationality).toBe('US');

      const licenseResult = await uploadIdDocument(
        validDocumentBuffer,
        'drivers_license',
        testUserId
      );
      expect(licenseResult.extracted_data.license_number).toBeDefined();
      expect(licenseResult.extracted_data.license_class).toBe('C');
      expect(licenseResult.extracted_data.state).toBe('CA');

      const idResult = await uploadIdDocument(
        validDocumentBuffer,
        'id_card',
        testUserId
      );
      expect(idResult.extracted_data.issued_by).toBe('State Government');
    });

    it('should log document upload activity', async () => {
      await uploadIdDocument(
        validDocumentBuffer,
        'id_card',
        testUserId
      );

      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(activities).toHaveLength(1);
      expect(activities[0].action).toBe('document_upload');
      expect(activities[0].details).toContain('id_card document uploaded');
    });

    it('should reject empty document buffer', async () => {
      await expect(uploadIdDocument(
        emptyBuffer,
        'id_card',
        testUserId
      )).rejects.toThrow(/document buffer is required/i);
    });

    it('should reject invalid document type', async () => {
      await expect(uploadIdDocument(
        validDocumentBuffer,
        'invalid_type' as any,
        testUserId
      )).rejects.toThrow(/valid document type is required/i);
    });

    it('should reject invalid user ID', async () => {
      await expect(uploadIdDocument(
        validDocumentBuffer,
        'passport',
        -1
      )).rejects.toThrow(/valid user id is required/i);
    });
  });

  describe('deleteFromS3', () => {
    it('should delete user files successfully', async () => {
      const userKeys = [
        `uploads/${testUserId}/test-file.jpg`,
        `faces/${testUserId}/face-image.jpg`,
        `documents/${testUserId}/id-document.jpg`
      ];

      for (const key of userKeys) {
        const result = await deleteFromS3(key, testUserId);
        expect(result.success).toBe(true);
      }
    });

    it('should log deletion activity', async () => {
      const key = `uploads/${testUserId}/test-file.jpg`;
      await deleteFromS3(key, testUserId);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(activities).toHaveLength(1);
      expect(activities[0].action).toBe('file_delete');
      expect(activities[0].details).toContain(key);
    });

    it('should reject empty file key', async () => {
      await expect(deleteFromS3('', testUserId)).rejects.toThrow(/file key is required/i);
      await expect(deleteFromS3('   ', testUserId)).rejects.toThrow(/file key is required/i);
    });

    it('should reject invalid user ID', async () => {
      await expect(deleteFromS3(
        `uploads/${testUserId}/test.jpg`,
        0
      )).rejects.toThrow(/valid user id is required/i);
    });

    it('should reject files that do not belong to user', async () => {
      const otherUserKey = `uploads/${testUserId + 1}/other-file.jpg`;
      await expect(deleteFromS3(
        otherUserKey,
        testUserId
      )).rejects.toThrow(/access denied.*does not belong to user/i);
    });

    it('should reject files outside user folders', async () => {
      const publicKey = 'public/shared-file.jpg';
      await expect(deleteFromS3(
        publicKey,
        testUserId
      )).rejects.toThrow(/access denied.*does not belong to user/i);
    });
  });

  describe('generatePresignedUrl', () => {
    it('should generate presigned URL for user files', async () => {
      const userKeys = [
        `uploads/${testUserId}/test-file.jpg`,
        `faces/${testUserId}/face-image.jpg`,
        `documents/${testUserId}/id-document.jpg`
      ];

      for (const key of userKeys) {
        const result = await generatePresignedUrl(key, testUserId);
        expect(result.signed_url).toContain('https://');
        expect(result.signed_url).toContain(key);
        expect(result.signed_url).toContain('X-Amz-Signature');
        expect(result.signed_url).toContain('X-Amz-Expires');
      }
    });

    it('should generate URL with custom expiration', async () => {
      const key = `uploads/${testUserId}/test-file.jpg`;
      const customExpiration = 7200; // 2 hours

      const result = await generatePresignedUrl(key, testUserId, customExpiration);
      expect(result.signed_url).toContain('https://');
    });

    it('should reject empty file key', async () => {
      await expect(generatePresignedUrl('', testUserId)).rejects.toThrow(/file key is required/i);
    });

    it('should reject invalid user ID', async () => {
      await expect(generatePresignedUrl(
        `uploads/${testUserId}/test.jpg`,
        0
      )).rejects.toThrow(/valid user id is required/i);
    });

    it('should reject files that do not belong to user', async () => {
      const otherUserKey = `uploads/${testUserId + 1}/other-file.jpg`;
      await expect(generatePresignedUrl(
        otherUserKey,
        testUserId
      )).rejects.toThrow(/access denied.*does not belong to user/i);
    });

    it('should reject invalid expiration times', async () => {
      const key = `uploads/${testUserId}/test-file.jpg`;

      // Too short
      await expect(generatePresignedUrl(
        key,
        testUserId,
        0
      )).rejects.toThrow(/expiration must be between 1 second and 7 days/i);

      // Too long (more than 7 days)
      await expect(generatePresignedUrl(
        key,
        testUserId,
        8 * 24 * 3600
      )).rejects.toThrow(/expiration must be between 1 second and 7 days/i);
    });

    it('should accept valid expiration ranges', async () => {
      const key = `uploads/${testUserId}/test-file.jpg`;
      const validExpirations = [1, 3600, 24 * 3600, 7 * 24 * 3600]; // 1 sec, 1 hour, 1 day, 7 days

      for (const expiration of validExpirations) {
        const result = await generatePresignedUrl(key, testUserId, expiration);
        expect(result.signed_url).toContain('https://');
      }
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete upload and delete cycle', async () => {
      // Upload a file
      const uploadResult = await uploadToS3(
        validDocumentBuffer,
        'integration-test.jpg',
        'image/jpeg',
        testUserId
      );

      expect(uploadResult.key).toStartWith(`uploads/${testUserId}/`);

      // Generate presigned URL
      const urlResult = await generatePresignedUrl(uploadResult.key, testUserId);
      expect(urlResult.signed_url).toContain(uploadResult.key);

      // Delete the file
      const deleteResult = await deleteFromS3(uploadResult.key, testUserId);
      expect(deleteResult.success).toBe(true);

      // Verify activity logs
      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(activities).toHaveLength(2); // Upload and delete
      expect(activities.some(a => a.action === 'file_upload')).toBe(true);
      expect(activities.some(a => a.action === 'file_delete')).toBe(true);
    });

    it('should handle face image upload with blacklist entry', async () => {
      const entryId = 789;
      const result = await uploadFaceImage(validImageBuffer, testUserId, entryId);

      expect(result.face_detected).toBe(true);
      expect(result.key).toStartWith(`faces/${testUserId}/`);

      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(activities[0].details).toContain(`entry ${entryId}`);
      expect(activities[0].details).toContain('confidence');
    });

    it('should handle document upload with OCR extraction', async () => {
      const docTypes = ['id_card', 'passport', 'drivers_license'] as const;
      
      for (const docType of docTypes) {
        const result = await uploadIdDocument(
          validDocumentBuffer,
          docType,
          testUserId
        );

        expect(result.extracted_data).toBeDefined();
        expect(typeof result.extracted_data.id_number).toBe('string');
        expect(typeof result.extracted_data.name).toBe('string');
        expect(typeof result.extracted_data.date_of_birth).toBe('string');
      }

      // Check that we have activity logs for all uploads
      const activities = await db.select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.user_id, testUserId))
        .execute();

      expect(activities).toHaveLength(3); // One for each document type
      expect(activities.every(a => a.action === 'document_upload')).toBe(true);
    });
  });
});