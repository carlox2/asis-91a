## 91a — tutor académico por voz

Asistente académico por voz para la materia **Neuropsicología**
(Cód. 91, Cátedra Politis, UBA Psicología). Fork de asis-laav con
la paleta cyan original y la materia/prompt/base reseteados para
cargar el contenido de 91a.

### Pendiente para terminar la ingesta

| Qué                          | Dónde                                                        |
| ---------------------------- | ------------------------------------------------------------ |
| Etiqueta visible             | `ASSISTANT_LABEL` en `src/lib/gemini.ts`                     |
| Prompt del sistema           | `SYSTEM_PROMPT` en `src/lib/gemini.ts` (placeholder vacío)   |
| PDFs de la base de conocimiento | `PDF_SOURCES` en `src/lib/gemini.ts` + archivos en `public/` |
| Modelo de IA                 | `GEMINI_MODEL` en `src/lib/gemini.ts` (default `gemini-3.6-flash`) |
| Volumen de los sonidos       | `SOUND_VOLUME` en `src/lib/sounds.ts`                        |
