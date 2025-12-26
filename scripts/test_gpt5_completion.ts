import { OpenAI } from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

async function testCompletion() {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    try {
        console.log('Testing gpt-5.2-pro with completions endpoint...');
        const response = await openai.completions.create({
            model: 'gpt-5.2-pro',
            prompt: 'Você é o GENIUS. Analise estes dados: \n- Comentário 1: "Qual a diferença?"\n- Comentário 2: "Como faz?"\n\nIdeias de vídeo:',
            max_tokens: 500,
        });
        console.log('Response:', response.choices[0].text);
    } catch (error: any) {
        console.error('Error with completions:', error.message);
    }
}

testCompletion();
