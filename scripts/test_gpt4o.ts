import { OpenAI } from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

async function testGpt4o() {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    try {
        console.log('Testing gpt-4o with chat/completions...');
        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'user', content: 'Say hello!' }
            ],
            model: 'gpt-4o',
        });
        console.log('Response:', completion.choices[0].message.content);
    } catch (error: any) {
        console.error('Error with gpt-4o:', error.message);
    }
}

testGpt4o();
