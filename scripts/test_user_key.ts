
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = "AIzaSyBYsoVEnQ9vwQUF4Y0Tf2yCyrx678CKbMo";
const genAI = new GoogleGenerativeAI(apiKey);

async function testKey() {
    const models = ['gemini-3-flash-preview', 'gemini-2.0-flash-exp', 'gemini-1.5-flash'];
    for (const m of models) {
        try {
            console.log(`Testing ${m}...`);
            const model = genAI.getGenerativeModel({ model: m });
            const result = await model.generateContent("test");
            console.log(`${m} works!`);
            return;
        } catch (e: any) {
            console.log(`${m} failed: ${e.message}`);
        }
    }
}

testKey();
