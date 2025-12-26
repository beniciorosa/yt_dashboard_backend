import { OpenAI } from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

async function testResponsesAPI() {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    try {
        console.log('Testing gpt-5.2-pro with responses.create...');
        // The "Responses API" often uses an "input" array of items
        const response = await (openai as any).responses.create({
            model: 'gpt-5.2-pro',
            input: [
                {
                    role: 'user',
                    content: [{ type: 'text', text: 'Say hello!' }]
                }
            ]
        });
        console.log('Response ID:', response.id);
        console.log('Content:', response.output?.[0]?.content?.[0]?.text || JSON.stringify(response.output, null, 2));
    } catch (error: any) {
        console.error('Error with responses.create:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }

        try {
            console.log('\nRetrying with chat-like structure in responses.create...');
            const response = await (openai as any).responses.create({
                model: 'gpt-5.2-pro',
                messages: [{ role: 'user', content: 'Say hello!' }]
            });
            console.log('Chat-like successful! ID:', response.id);
        } catch (error2: any) {
            console.error('Chat-like failed:', error2.message);
        }
    }
}

testResponsesAPI();
