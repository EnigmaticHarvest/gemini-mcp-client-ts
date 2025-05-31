import fs from 'fs';
import { Part } from "@google/generative-ai";
import chalk from 'chalk';

// Helper function to determine MIME type from file extension
export function determineMimeType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    // Basic mime types, can be expanded based on common use cases
    switch (extension) {
        case 'txt': return 'text/plain';
        case 'json': return 'application/json';
        case 'xml': return 'application/xml';
        case 'csv': return 'text/csv';
        case 'md': return 'text/markdown';
        case 'html': return 'text/html';
        case 'css': return 'text/css';
        case 'js': return 'application/javascript';
        case 'ts': return 'application/typescript';

        case 'png': return 'image/png';
        case 'jpg': case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        case 'svg': return 'image/svg+xml';
        case 'heic': return 'image/heic';
        case 'heif': return 'image/heif';

        case 'pdf': return 'application/pdf';
        case 'doc': return 'application/msword';
        case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case 'xls': return 'application/vnd.ms-excel';
        case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        case 'ppt': return 'application/vnd.ms-powerpoint';
        case 'pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

        case 'mp3': return 'audio/mpeg';
        case 'wav': return 'audio/wav';
        case 'ogg': return 'audio/ogg';

        case 'mp4': return 'video/mp4';
        case 'webm': return 'video/webm';
        case 'mov': return 'video/quicktime';

        default: return 'application/octet-stream'; // Generic fallback
    }
}

// Function to process user input, parse for localfile() directives, and prepare Parts for Gemini
export async function processUserInput(userInput: string): Promise<string | Part[]> {
    const fileRegex = /localfile\(([^)]+)\)/g; // captures path within localfile(), added 'g' flag back

    const segments: Array<{ type: 'text'; content: string } | { type: 'file'; filePath: string, originalMatch: string, promiseIndex: number }> = [];
    const fileProcessingPromises: Promise<Part>[] = [];
    let lastIndex = 0;
    let match;
    let promiseCounter = 0;

    // Segment the input into text and file placeholders
    while ((match = fileRegex.exec(userInput)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: userInput.substring(lastIndex, match.index) });
        }
        const filePath = match[1]; // The captured path
        const originalMatch = match[0]; // The full "localfile(...)" string
        segments.push({ type: 'file', filePath, originalMatch, promiseIndex: promiseCounter });
        console.log(chalk.blue(`  Found localfile() directive: ${filePath}`));

        fileProcessingPromises.push(
            fs.promises.readFile(filePath)
                .then(fileBuffer => {
                    const base64Data = fileBuffer.toString('base64');
                    const mimeType = determineMimeType(filePath);
                    console.log(chalk.blue(`  Successfully processed and encoded file: ${filePath} as ${mimeType}`));
                    return { inlineData: { mimeType, data: base64Data } };
                })
                .catch(error => {
                    console.error(chalk.red(`  Error reading file ${filePath}: ${(error as Error).message}`));
                    // Return a text part indicating the error and the original placeholder
                    return { text: `[File Error: Could not load '${filePath}'. Reason: ${(error as Error).message}. Original placeholder: '${originalMatch}']` };
                })
        );
        promiseCounter++;
        lastIndex = fileRegex.lastIndex;
    }
    // Add any remaining text after the last match (or the full string if no matches)
    if (lastIndex < userInput.length) {
        segments.push({ type: 'text', content: userInput.substring(lastIndex) });
    }

    if (fileProcessingPromises.length === 0) {
        // No localfile() directives found, use userInput as is.
        return userInput;
    }

    const resolvedFileParts = await Promise.all(fileProcessingPromises);
    const assembledParts: Part[] = [];

    // Reconstruct the message from segments and resolved file parts
    for (const segment of segments) {
        if (segment.type === 'text') {
            assembledParts.push({ text: segment.content });
        } else { // segment.type === 'file'
            // Use the part from the corresponding resolved promise
            assembledParts.push(resolvedFileParts[segment.promiseIndex]);
        }
    }

    // Consolidate consecutive text parts and filter out empty text parts
    const finalConsolidatedParts: Part[] = [];
    let textBuffer = "";
    for (const part of assembledParts) {
        if (part.text !== undefined) {
            textBuffer += part.text;
        } else if (part.inlineData !== undefined) {
            if (textBuffer.length > 0) {
                finalConsolidatedParts.push({ text: textBuffer });
                textBuffer = "";
            }
            finalConsolidatedParts.push(part); // Add the inlineData part
        }
    }
    if (textBuffer.length > 0) { // Add any remaining accumulated text
        finalConsolidatedParts.push({ text: textBuffer });
    }
    
    // Filter out parts that are text but completely empty (e.g., from between two file tags "" )
    let processedParts = finalConsolidatedParts.filter(p => {
        return ! (p.text !== undefined && p.text.length === 0);
    });

    // If processing resulted in an empty array of parts (e.g. input was only "localfile(nonexistent.txt)" and error message logic failed to produce visible text)
    // and original input was not empty, send the original input as a single text part.
    if (processedParts.length === 0 && userInput.length > 0) {
        console.warn(chalk.yellow("  Processed parts resulted in an empty message; sending original input as a single text part."));
        processedParts = [{ text: userInput }];
    } else if (processedParts.length === 0 && userInput.length === 0) {
         return ""; // Empty input string leads to empty message string for Gemini
    }
    return processedParts;
} 