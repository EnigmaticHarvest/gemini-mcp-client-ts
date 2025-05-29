// src/envConfig.ts
import dotenv from 'dotenv';
dotenv.config(); // Load .env file from project root

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_NAME = process.env.GEMINI_MODEL_NAME;


