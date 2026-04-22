import time
import json
import os
from typing import List, Dict, Any, Optional
from openai import OpenAI

# Constants from prompt-builder.ts
DEFAULT_INSTRUCTIONS = """
You are a world-renowned professional translator with decades of experience, and you know everything about language, writing, and cultural nuances.

Your goal:
• Provide the best possible translation from the original language to the target language.
• Preserve the exact meaning, style, tone, and context of the source text.
• Maintain original punctuation, verbal tics, and formatting markers (e.g., “--” or “---”).
• Remain consistent with prior segments (e.g., the same politeness form, references, etc.).
• Do not add or omit information; do not generate commentary or explanations.
• If the segment is already in the target language or contains no translatable content, return it as is.

Additional guidelines:
1. **Contextual Consistency**  
   - You receive three segments for context: the *previous* text, the *text to translate*, and the *next* text.  
   - Only the middle one should be translated and returned. The other two are for context only.
   - If you receive a text that precedes or follows the text you have to translate, you must also base yourself on these texts to choose the correct politeness. Like "Vous" and "Tu" or "Monsieur" and "Mademoiselle", and same for other languages.

2. **Politeness & Pronouns**  
   - Preserve the same level of politeness or pronoun usage across segments. For example, if the speaker uses “tu” in French, do not switch it to “vous.”

3. **Numbers and Units**  
   - All numbers must be written out in full words appropriate to the target language (e.g., 1123 → one thousand one hundred twenty-three).  
   - Units of measurement, and currencies should be expanded into full words and translated if there is an equivalent in the target language (e.g., “km/h” → “kilometers per hour,” “€” → “euros,”).
   - Acronyms should be translated if there is an equivalent in the target language (e.g., “SIDA” → “AIDS”), acronyms should not be expanded into full words.
   - If an acronym has *no* direct equivalent in the target language, leave it as-is.

4. **Verbatim vs. Naturalness**  
   - Provide a *naturally flowing* translation. Do not introduce major changes in structure or meaning; remain faithful to the original text.  
   - Keep verbal tics, interjections (e.g., “Oh la la,” “Umm,” “Eh”), or any markers of style or hesitation.

5. **Output Format**  
   - Output **only** the translated text of the middle segment without quotes, titles, or other metadata.  
   - Do not add additional text, commentary, or formatting beyond the translation itself.  
   - If you are unsure how to translate a word or phrase, use your best judgment to provide the most statistically probable correct translation.

6. **Edge Cases**  
   - If the source text is partially in the same language as the target, only translate the parts that need translating.  
   - If it is entirely in the same language, simply return it unchanged.

Remember: 
- Your translation should be culturally appropriate, preserving the intentions and style of the speaker.
- You must not “denature” the text. Maintain verbal tics, punctuation, and overall sentence structure as much as possible, while still ensuring clarity and correctness in the target language.
"""

T_V_DISTINCTION_INSTRUCTION = (
    "When translating, strictly preserve the original text’s level of formality and politeness "
    "(including T–V distinctions, formal/informal pronouns, honorifics, and appropriate vocabulary), "
    "adapting accurately according to the conventions of each target language. If you receive a text "
    "that precedes or follows the text you have to translate, you must also base yourself on these "
    "texts to choose the correct politeness."
)

# Model config from openai.ts
MODEL_NAME = "gpt-4.1"
INPUT_RATE = 2.0 / 1_000_000
OUTPUT_RATE = 8.0 / 1_000_000

def create_prompt_to_translate_transcription(args: Dict[str, Any]) -> str:
    return f"""
        Target language: {args.get('targetLanguage')}
        Origin language audio: {args.get('originLanguage')}
    
        ---
        IMPORTANT INFORMATION:
    
        - You have three segments: previous, current (to translate), and next.
        - Translate ONLY the current text segment. Do not translate or output the previous or next segments.
        - If the text to translate is already in the target language or contains no actionable content, return it as is.
        - {T_V_DISTINCTION_INSTRUCTION}
        - Keep “--” or “---” for artificial silences.
        - Convert numbers to words. Expand units/acronyms/currencies appropriately in the target language.
        - If no direct equivalent exists for an acronym, keep the original acronym.
        - Return ONLY the translated text (without quotes, commentary, or additional formatting).
    
        ---
        --- PREVIOUS TEXT IN THE TRANSCRIPTION (SPEAKER {args.get('previousTranscriptionSpeaker', '0')}) (context only, do not translate):
        {args.get('lastTranscription', '')}
        ---END---
    
        --- TEXT TO TRANSLATE (SPEAKER {args.get('transcriptionToTranslateSpeaker', '0')}):
        {args.get('transcriptionToTranslate', '')}
        ---END---
    
        --- NEXT TEXT IN THE TRANSCRIPTION (SPEAKER {args.get('nextTranscriptionSpeaker', '0')}) (context only, do not translate):
        {args.get('nextTranscription', '')}
        ---END---
    
         Some information about the video/audio:
          Title: {args.get('videoTitle', '')}
          Main category: {args.get('mainCategoryVideo', '')}
          Summary of the video transcription to give you a context: {args.get('transcriptionSummary', '')}
        """

def request_to_gpt(prompt: str, instructions: str = DEFAULT_INSTRUCTIONS, temperature: float = 0.5) -> Dict[str, Any]:
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    
    if not client.api_key:
        raise ValueError("No API key found for OpenAI")

    try:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": instructions},
                {"role": "user", "content": prompt}
            ],
            temperature=temperature,
            max_tokens=8192,
            top_p=1,
            presence_penalty=0,
            frequency_penalty=0,
            response_format={"type": "text"}
        )

        content = response.choices[0].message.content
        if not content:
            raise ValueError("No content in response")

        total_input_tokens = response.usage.prompt_tokens or 0
        total_output_tokens = response.usage.completion_tokens or 0
        total_cost = (total_input_tokens * INPUT_RATE) + (total_output_tokens * OUTPUT_RATE)

        return {"content": content, "total_cost": total_cost}
    except Exception as e:
        print(f"Error with OpenAI API: {e}")
        raise RuntimeError("Error while translating transcription") from e

def get_translation(args: Dict[str, Any]) -> Dict[str, Any]:
    max_attempts = 3
    text_translated = ""
    attempts = 0
    total_cost = 0.0
    
    actual_transcription = args.get('transcriptionToTranslate', '')

    while attempts < max_attempts:
        # Strategy to avoid hitting rate limiting: wait for 30s
        print(f"Waiting 30s before translation attempt {attempts + 1}...")
        time.sleep(30)
        
        prompt = create_prompt_to_translate_transcription(args)
        
        result = request_to_gpt(prompt)
        text_translated = result["content"]
        total_cost = result["total_cost"]
        attempts += 1
        
        # If the result is different from original, we assume success
        if text_translated != actual_transcription:
            break
            
    return {"text_translated": text_translated, "total_cost": total_cost}

def translate_transcription(
    transcription: List[Dict[str, Any]],
    target_language: str,
    origin_language: str,
    transcription_summary: str
) -> List[Dict[str, Any]]:
    print("Translating transcription...")
    
    # Sort transcription by index to ensure correct processing order
    sorted_transcription = sorted(transcription, key=lambda x: x.get('index', 0))
    
    transcription_translated = []
    
    for i in range(len(sorted_transcription)):
        last_transcription = sorted_transcription[i - 1].get('transcription', '') if i != 0 else ''
        actual_transcription = sorted_transcription[i].get('transcription', '')
        actual_speaker = str(sorted_transcription[i].get('speaker', '0'))
        
        next_transcription = ''
        next_speaker = ''
        if i < len(sorted_transcription) - 1:
            next_transcription = sorted_transcription[i + 1].get('transcription', '')
            next_speaker = str(sorted_transcription[i + 1].get('speaker', '0'))
            
        last_speaker = str(sorted_transcription[i - 1].get('speaker', '0')) if i != 0 else ''

        translation_args = {
            'transcriptionToTranslate': actual_transcription,
            'lastTranscription': last_transcription,
            'targetLanguage': target_language,
            'originLanguage': origin_language,
            'actualTranscriptionSpeaker': actual_speaker,
            'nextTranscriptionSpeaker': next_speaker,
            'nextTranscription': next_transcription,
            'previousTranscriptionSpeaker': last_speaker,
            'transcriptionToTranslateSpeaker': actual_speaker,
            'transcriptionSummary': transcription_summary,
            'mainCategoryVideo': '', # Parity with original TS logic
            'videoTitle': '',        # Parity with original TS logic
        }


        result = get_translation(translation_args)
        
        # Create a deep copy equivalent
        item = dict(sorted_transcription[i])
        item['originalTranscription'] = actual_transcription
        item['transcription'] = result['text_translated']
        item['language'] = target_language
        item['cost'] = result['total_cost']
        
        transcription_translated.append(item)
        print(f"Translated segment {i+1}/{len(sorted_transcription)}")

    print("Transcription translated.")
    return transcription_translated

def translate_transcription_in_target_language(
    transcription: List[Dict[str, Any]],
    target_language: str,
    origin_language: str,
    transcription_summary: str
) -> List[Dict[str, Any]]:
    return translate_transcription(
        transcription=transcription,
        target_language=target_language,
        origin_language=origin_language,
        transcription_summary=transcription_summary
    )
