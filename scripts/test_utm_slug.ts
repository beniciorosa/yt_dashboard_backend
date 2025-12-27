
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OpenaiService } from '../src/openai/openai.service';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const openaiService = app.get(OpenaiService);

    const title = "Como vender mais no Mercado Livre em 2025";
    console.log(`Testing slug generation for title: "${title}"`);

    try {
        const slug = await openaiService.generateSlug(title);
        console.log(`Generated Slug: ${slug}`);

        if (slug && slug.includes('meli') && !slug.includes(' ')) {
            console.log("SUCCESS: Slug generated correctly with GPT-4o rules.");
        } else {
            console.log("WARNING: Slug generated but check if rules were followed (meli, hyphenated).");
        }
    } catch (error) {
        console.error("FAILED: Slug generation error:", error);
    }

    await app.close();
}

bootstrap();
