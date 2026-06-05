// Shared Gemma-vision helpers. Image requests go through Ollama's NATIVE API
// (chatWithImages / streamChatWithImages) because the OpenAI-compatible /v1
// image_url path fails for GGUF vision models. Used by api/vision (streamed)
// and api/capture (one-shot, to describe a captured screenshot into an Idea).
import { chatWithImages } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";

export const DEFAULT_VISION_PROMPT =
  "Describe this image in detail. If it contains text, transcribe it.";

/** One-shot description of an image (data URL or base64) using the vision model. */
export async function describeImage(image: string, prompt?: string): Promise<string> {
  const { baseUrl, temperature, visionModel } = await getEffectiveConfig();
  return chatWithImages(prompt?.trim() || DEFAULT_VISION_PROMPT, [image], {
    model: visionModel,
    baseUrl,
    temperature,
  });
}
