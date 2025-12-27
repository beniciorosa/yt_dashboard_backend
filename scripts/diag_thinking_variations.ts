
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function listThinkingModels() {
    const variations = [
        'gemini-2.0-flash-thinking-exp-1219',
        'gemini-2.0-flash-thinking-exp',
        'gemini-2.0-flash-exp',
        'learnlm-1.5-pro-experimental'
    ];

    for (const m of variations) {
        try {
            console.log(`Testing variation: ${m}...`);
            const model = genAI.getGenerativeModel({ model: m });
            const result = await model.generateContent("test");
            console.log(`Model ${m}: OK!`);
        } catch (e: any) {
            console.log(`Model ${m}: FAILED - ${e.message}`);
        }
    }
}

listThinkingModels();
