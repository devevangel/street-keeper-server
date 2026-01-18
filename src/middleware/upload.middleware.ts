/**
 * File Upload Middleware
 * Handles GPX file uploads using memory storage (no disk persistence)
 *
 * This middleware uses Multer to:
 * - Accept multipart/form-data file uploads
 * - Store files in memory (Buffer) for processing
 * - Validate file extension (.gpx only)
 * - Enforce file size limits (10MB max)
 *
 * Usage in routes:
 *   router.post("/upload", uploadGpx.single("gpx"), handleMulterError, handler)
 */

import multer from "multer";
import path from "path";
import { Request, Response, NextFunction } from "express";
import { GPX_UPLOAD, ERROR_CODES } from "../config/constants.js";

// ============================================
// Storage Configuration
// ============================================

/**
 * Memory storage configuration
 * Files are stored in memory as Buffer objects (req.file.buffer)
 * This avoids disk I/O and simplifies cleanup - no temp files to delete
 */
const storage = multer.memoryStorage();

// ============================================
// File Filter
// ============================================

/**
 * File filter function
 * Validates that uploaded files have .gpx extension
 *
 * @param req - Express request object
 * @param file - Multer file object with originalname, mimetype, etc.
 * @param cb - Callback: cb(error) to reject, cb(null, true) to accept
 */
const fileFilter: multer.Options["fileFilter"] = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext !== ".gpx") {
    // Reject file - pass error message that handleMulterError will catch
    cb(new Error("Only .gpx files are allowed"));
    return;
  }

  // Accept file
  cb(null, true);
};

// ============================================
// Multer Instance
// ============================================

/**
 * Configured Multer instance for GPX uploads
 *
 * Configuration:
 * - storage: Memory storage (files in Buffer)
 * - fileFilter: Only .gpx files accepted
 * - limits.fileSize: Max 10MB (from GPX_UPLOAD.MAX_FILE_SIZE_BYTES)
 *
 * Usage:
 *   uploadGpx.single("gpx") - Expects single file in "gpx" form field
 */
export const uploadGpx = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: GPX_UPLOAD.MAX_FILE_SIZE_BYTES,
  },
});

// ============================================
// Error Handler Middleware
// ============================================

/**
 * Error handler for Multer upload errors
 *
 * Catches and formats errors from Multer into consistent API responses.
 * Must be placed AFTER uploadGpx middleware in the route chain.
 *
 * Handles:
 * - LIMIT_FILE_SIZE: File exceeds 10MB limit
 * - Custom filter error: Non-.gpx file rejected
 * - Other errors: Passed to next error handler
 *
 * @param error - Error thrown by Multer or file filter
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Next middleware function
 *
 * @example
 * router.post(
 *   "/analyze-gpx",
 *   uploadGpx.single("gpx"),
 *   handleMulterError,  // <-- Catches upload errors
 *   async (req, res) => { ... }
 * );
 */
export function handleMulterError(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Handle Multer-specific errors
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        success: false,
        error: "File too large. Maximum size is 10MB.",
        code: ERROR_CODES.GPX_FILE_TOO_LARGE,
      });
      return;
    }
    // Other Multer errors (LIMIT_FIELD_COUNT, etc.)
    res.status(400).json({
      success: false,
      error: `Upload error: ${error.message}`,
      code: ERROR_CODES.GPX_INVALID_FORMAT,
    });
    return;
  }

  // Handle file filter rejection
  if (error.message === "Only .gpx files are allowed") {
    res.status(400).json({
      success: false,
      error: error.message,
      code: ERROR_CODES.GPX_INVALID_FORMAT,
    });
    return;
  }

  // Pass other errors to default error handler
  next(error);
}
