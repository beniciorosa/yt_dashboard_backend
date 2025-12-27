
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function listModels() {
    try {
        console.log("Using API Key starting with:", process.env.GEMINI_API_KEY?.substring(0, 10));
        // The SDK doesn't have a direct listModels, but we can try to initialize some common names
        const models = ['gemini-3-flash', 'gemini-2.0-flash-thinking-exp', 'gemini-2.0-flash-exp', 'gemini-1.5-flash'];

        for (const m of models) {
            try {
                const model = genAI.getGenerativeModel({ model: m });
                const result = await model.generateContent("test");
                console.log(`Model ${m}: OK`);
                return m;
            } catch (e: any) {
                console.log(`Model ${m}: FAILED - ${e.message}`);
            }
        }
    } catch (e: any) {
        console.error("List models failed:", e);
    }
}

listModels();
