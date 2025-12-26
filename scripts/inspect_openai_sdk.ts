import { OpenAI } from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

function inspectOpenAI() {
    const openai = new OpenAI({
        apiKey: 'dummy',
    });

    console.log('OpenAI object keys:');
    console.log(Object.keys(openai));

    if ((openai as any).responses) {
        console.log('\nResponses namespace detected!');
        console.log('Methods:', Object.keys((openai as any).responses));
    } else {
        console.log('\nResponses namespace NOT found.');
    }

    if ((openai as any).chat) {
        console.log('\nChat namespace methods:', Object.keys((openai as any).chat));
        if ((openai as any).chat.completions) {
            console.log('Chat.completions methods:', Object.keys((openai as any).chat.completions));
        }
    }
}

inspectOpenAI();
