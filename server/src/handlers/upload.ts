import { db } from '../db';
import { activityLogsTable } from '../db/schema';

// Mock AWS services - in real implementation, these would be actual AWS SDK calls
const AWS_BUCKET = process.env['AWS_S3_BUCKET'] || 'blacklist-system-bucket';
const AWS_REGION = process.env['AWS_REGION'] || 'us-east-1';

// File size limits (in bytes)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

// Allowed content types
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];
const ALLOWED_DOCUMENT_TYPES = [...ALLOWED_IMAGE_TYPES, 'application/pdf'];

// Helper to generate unique file key
const generateFileKey = (folder: string, userId: number, originalName: string): string => {
  const timestamp = Date.now();
  const extension = originalName.split('.').pop() || 'bin';
  const baseName = originalName.split('.')[0] || 'file';
  return `${folder}/${userId}/${timestamp}-${baseName}.${extension}`;
};

// Helper to validate file size and type
const validateFile = (buffer: Buffer, contentType: string, allowedTypes: string[], maxSize: number) => {
  if (buffer.length > maxSize) {
    throw new Error(`File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`);
  }
  
  if (!allowedTypes.includes(contentType)) {
    throw new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`);
  }
};

// Mock S3 upload - in real implementation, this would use AWS SDK
const mockS3Upload = async (key: string, buffer: Buffer, contentType: string): Promise<string> => {
  // Simulate upload delay
  await new Promise(resolve => setTimeout(resolve, 100));
  return `https://${AWS_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
};

// Mock face detection - in real implementation, this would use AWS Rekognition
const mockFaceDetection = async (buffer: Buffer): Promise<{ faces: number; confidence: number }> => {
  // Simulate face detection processing
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Simple mock logic based on buffer size (for testing purposes)
  const fakeConfidence = Math.min(95, 75 + (buffer.length % 20));
  const faces = buffer.length >= 30 ? 1 : 0; // Mock: buffers >= 30 bytes have faces
  
  return { faces, confidence: fakeConfidence };
};

// Mock OCR extraction - in real implementation, this would use AWS Textract
const mockOCRExtraction = async (buffer: Buffer, documentType: string): Promise<any> => {
  // Simulate OCR processing
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Mock extracted data based on document type
  const baseData = {
    id_number: `${documentType.toUpperCase()}${Math.floor(Math.random() * 1000000000)}`,
    name: 'John Doe',
    date_of_birth: '1990-01-01'
  };

  switch (documentType) {
    case 'passport':
      return {
        ...baseData,
        passport_number: baseData.id_number,
        nationality: 'US',
        expiration_date: '2030-01-01'
      };
    case 'drivers_license':
      return {
        ...baseData,
        license_number: baseData.id_number,
        license_class: 'C',
        expiration_date: '2029-01-01',
        state: 'CA'
      };
    default: // id_card
      return {
        ...baseData,
        expiration_date: '2030-01-01',
        issued_by: 'State Government'
      };
  }
};

// Log activity helper
const logActivity = async (userId: number, action: string, details?: string) => {
  try {
    await db.insert(activityLogsTable).values({
      user_id: userId,
      action,
      resource_type: 'file',
      details: details || null,
      ip_address: null,
      user_agent: null
    }).execute();
  } catch (error) {
    console.error('Failed to log activity:', error);
    // Don't throw - logging failure shouldn't break the main operation
  }
};

export async function uploadToS3(
  file: Buffer, 
  fileName: string, 
  contentType: string,
  userId: number
): Promise<{ url: string; key: string }> {
  try {
    // Validate input
    if (!file || file.length === 0) {
      throw new Error('File buffer is required');
    }
    if (!fileName || fileName.trim() === '') {
      throw new Error('File name is required');
    }
    if (!contentType) {
      throw new Error('Content type is required');
    }
    if (!userId || userId <= 0) {
      throw new Error('Valid user ID is required');
    }

    // Validate file
    validateFile(file, contentType, ALLOWED_DOCUMENT_TYPES, MAX_FILE_SIZE);

    // Generate unique key
    const key = generateFileKey('uploads', userId, fileName);

    // Upload to S3 (mock)
    const url = await mockS3Upload(key, file, contentType);

    // Log upload activity
    await logActivity(userId, 'file_upload', `Uploaded file: ${fileName} (${file.length} bytes)`);

    return { url, key };
  } catch (error) {
    console.error('S3 upload failed:', error);
    throw error;
  }
}

export async function uploadFaceImage(
  imageBuffer: Buffer, 
  userId: number,
  entryId?: number
): Promise<{ url: string; key: string; face_detected: boolean }> {
  try {
    // Validate input
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Image buffer is required');
    }
    if (!userId || userId <= 0) {
      throw new Error('Valid user ID is required');
    }

    // Validate image (assume JPEG for buffer validation)
    validateFile(imageBuffer, 'image/jpeg', ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE);

    // Detect faces
    const faceDetection = await mockFaceDetection(imageBuffer);
    
    if (faceDetection.faces === 0) {
      throw new Error('No face detected in the image');
    }
    if (faceDetection.faces > 1) {
      throw new Error('Multiple faces detected. Please upload an image with a single face');
    }
    if (faceDetection.confidence < 75) {
      throw new Error('Face detection confidence too low. Please upload a clearer image');
    }

    // Generate unique key
    const key = generateFileKey('faces', userId, 'face-image.jpg');

    // Upload to S3 (mock)
    const url = await mockS3Upload(key, imageBuffer, 'image/jpeg');

    // Log upload activity
    await logActivity(
      userId, 
      'face_image_upload', 
      `Face image uploaded${entryId ? ` for entry ${entryId}` : ''} (confidence: ${faceDetection.confidence}%)`
    );

    return { 
      url, 
      key, 
      face_detected: true 
    };
  } catch (error) {
    console.error('Face image upload failed:', error);
    throw error;
  }
}

export async function uploadIdDocument(
  documentBuffer: Buffer,
  documentType: 'id_card' | 'passport' | 'drivers_license',
  userId: number,
  entryId?: number
): Promise<{ url: string; key: string; extracted_data?: any }> {
  try {
    // Validate input
    if (!documentBuffer || documentBuffer.length === 0) {
      throw new Error('Document buffer is required');
    }
    if (!documentType || !['id_card', 'passport', 'drivers_license'].includes(documentType)) {
      throw new Error('Valid document type is required (id_card, passport, drivers_license)');
    }
    if (!userId || userId <= 0) {
      throw new Error('Valid user ID is required');
    }

    // Validate document (assume JPEG for buffer validation)
    validateFile(documentBuffer, 'image/jpeg', ALLOWED_IMAGE_TYPES, MAX_FILE_SIZE);

    // Extract data using OCR
    const extractedData = await mockOCRExtraction(documentBuffer, documentType);

    // Generate unique key
    const key = generateFileKey('documents', userId, `${documentType}-document.jpg`);

    // Upload to S3 (mock)
    const url = await mockS3Upload(key, documentBuffer, 'image/jpeg');

    // Log upload activity
    await logActivity(
      userId, 
      'document_upload', 
      `${documentType} document uploaded${entryId ? ` for entry ${entryId}` : ''} (${documentBuffer.length} bytes)`
    );

    return { 
      url, 
      key, 
      extracted_data: extractedData 
    };
  } catch (error) {
    console.error('ID document upload failed:', error);
    throw error;
  }
}

export async function deleteFromS3(key: string, userId: number): Promise<{ success: boolean }> {
  try {
    // Validate input
    if (!key || key.trim() === '') {
      throw new Error('File key is required');
    }
    if (!userId || userId <= 0) {
      throw new Error('Valid user ID is required');
    }

    // Validate that file belongs to user (check key prefix)
    const userPrefixes = [`uploads/${userId}/`, `faces/${userId}/`, `documents/${userId}/`];
    const belongsToUser = userPrefixes.some(prefix => key.startsWith(prefix));
    
    if (!belongsToUser) {
      throw new Error('Access denied: File does not belong to user');
    }

    // Mock S3 deletion - in real implementation, this would use AWS SDK
    await new Promise(resolve => setTimeout(resolve, 100));

    // Log deletion activity
    await logActivity(userId, 'file_delete', `Deleted file: ${key}`);

    return { success: true };
  } catch (error) {
    console.error('S3 deletion failed:', error);
    throw error;
  }
}

export async function generatePresignedUrl(
  key: string,
  userId: number,
  expirationSeconds: number = 3600
): Promise<{ signed_url: string }> {
  try {
    // Validate input
    if (!key || key.trim() === '') {
      throw new Error('File key is required');
    }
    if (!userId || userId <= 0) {
      throw new Error('Valid user ID is required');
    }
    if (expirationSeconds <= 0 || expirationSeconds > 7 * 24 * 3600) { // Max 7 days
      throw new Error('Expiration must be between 1 second and 7 days');
    }

    // Validate that file belongs to user or user has access
    const userPrefixes = [`uploads/${userId}/`, `faces/${userId}/`, `documents/${userId}/`];
    const belongsToUser = userPrefixes.some(prefix => key.startsWith(prefix));
    
    if (!belongsToUser) {
      throw new Error('Access denied: File does not belong to user');
    }

    // Mock presigned URL generation - in real implementation, this would use AWS SDK
    const expirationTime = Date.now() + (expirationSeconds * 1000);
    const signature = Math.random().toString(36).substring(7);
    const signed_url = `https://${AWS_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}?X-Amz-Signature=${signature}&X-Amz-Expires=${expirationTime}`;

    return { signed_url };
  } catch (error) {
    console.error('Presigned URL generation failed:', error);
    throw error;
  }
}