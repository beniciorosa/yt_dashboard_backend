import { OpenAI } from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

async function testResponsesAPI() {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    try {
        console.log('Testing gpt-5.2-pro with responses.create (v4)...');
        const response = await (openai as any).responses.create({
            model: 'gpt-5.2-pro',
            input: [
                {
                    role: 'user',
                    content: [{ type: 'input_text', text: 'Say hello!' }]
                }
            ],
            reasoning: {
                effort: 'xhigh'
            }
        });

        console.log('Success! ID:', response.id);
        const outputText = response.output?.find((o: any) => o.type === 'output_text')?.text;
        console.log('Content:', outputText || JSON.stringify(response.output, null, 2));

    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

testResponsesAPI();
