
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function diagGemini3() {
    try {
        const modelName = 'gemini-3-flash-preview';
        console.log(`Testing model ${modelName}...`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Oi, você é o Gemini 3 Flash?");
        const response = await result.response;
        console.log("Response successful! Content:", response.text());
    } catch (e: any) {
        console.error("Gemini 3 Flash failed:");
        console.error(e.message || e);
    }
}

diagGemini3();
