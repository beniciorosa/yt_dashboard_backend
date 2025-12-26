import { OpenAI } from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

async function testGeneration() {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    try {
        console.log('Testing gpt-5.2-pro with system/user roles...');
        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Say hello!' }
            ],
            model: 'gpt-5.2-pro',
        });
        console.log('Response:', completion.choices[0].message.content);
    } catch (error: any) {
        console.error('Error with system/user:', error.message);

        try {
            console.log('\nTesting gpt-5.2-pro with developer/user roles...');
            const completion = await openai.chat.completions.create({
                messages: [
                    { role: 'developer', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'Say hello!' }
                ],
                model: 'gpt-5.2-pro',
            });
            console.log('Response:', completion.choices[0].message.content);
        } catch (error2: any) {
            console.error('Error with developer/user:', error2.message);

            try {
                console.log('\nTesting gpt-5.2-pro with ONLY user role...');
                const completion = await openai.chat.completions.create({
                    messages: [
                        { role: 'user', content: 'System: You are a helpful assistant.\n\nUser: Say hello!' }
                    ],
                    model: 'gpt-5.2-pro',
                });
                console.log('Response:', completion.choices[0].message.content);
            } catch (error3: any) {
                console.error('Error with only user:', error3.message);
            }
        }
    }
}

testGeneration();
