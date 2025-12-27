
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function diagOpenAI() {
    try {
        console.log("Using API Key starting with:", process.env.OPENAI_API_KEY?.substring(0, 10));
        const targetModel = 'gpt-5.2-pro';

        console.log(`Testing model ${targetModel} via Responses API...`);

        const response = await (openai as any).responses.create({
            model: targetModel,
            input: [
                {
                    role: 'user',
                    content: [{ type: 'input_text', text: "oi" }]
                }
            ],
            reasoning: {
                effort: 'high'
            }
        });

        console.log("Response successful! Output text:", response.output_text);
    } catch (e: any) {
        console.error("OpenAI failed:");
        console.error(e.message || e);
        if (e.response) {
            console.error("Sub-error status:", e.response.status);
            console.error("Sub-error data:", JSON.stringify(e.response.data));
        }
    }
}

diagOpenAI();
