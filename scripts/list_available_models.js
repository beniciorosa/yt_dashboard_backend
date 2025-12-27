
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        // The listModels call is actually not on the genAI instance directly in some versions, 
        // it's an API call. Let's try to find it or use a simpler approach.
        // In @google/generative-ai, there isn't a direct listModels.
        // We have to use the REST API or discovery.
        // Let's try common thinking aliases.
        const aliases = [
            'gemini-2.0-flash-thinking-exp-1219',
            'gemini-2.0-flash-thinking-exp',
            'gemini-2.0-flash-exp',
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-3-flash-preview'
        ];
        for (const modelName of aliases) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                await model.generateContent("hi");
                console.log(`Model ${modelName}: AVAILABLE`);
            } catch (e) {
                console.log(`Model ${modelName}: NOT AVAILABLE (${e.message})`);
            }
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

listModels();
