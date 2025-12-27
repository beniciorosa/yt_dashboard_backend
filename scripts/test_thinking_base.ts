
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function testThinking() {
    try {
        const m = 'gemini-2.0-flash-thinking-exp';
        console.log(`Testing: ${m}...`);
        const model = genAI.getGenerativeModel({ model: m });
        const result = await model.generateContent("test");
        console.log(`Model ${m}: OK!`);
    } catch (e: any) {
        console.log(`Model gemini-2.0-flash-thinking-exp: FAILED - ${e.message}`);
    }
}

testThinking();
