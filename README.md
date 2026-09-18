## 91a — tutor académico por voz

Fork operativo de `asis-laav` con la paleta cyan original y el
header `LAAV` reemplazado por `91a`. Listo para ingestar el system
prompt y la base de conocimiento de otra materia.

### Pendiente para terminar la ingesta

| Qué                          | Dónde                                                        |
| ---------------------------- | ------------------------------------------------------------ |
| Etiqueta visible             | `ASSISTANT_LABEL` en `src/lib/gemini.ts`                     |
| Prompt del sistema           | `SYSTEM_PROMPT` en `src/lib/gemini.ts` (placeholder vacío)   |
| PDFs de la base de conocimiento | `PDF_SOURCES` en `src/lib/gemini.ts` + archivos en `public/` |
| Modelo de IA                 | `GEMINI_MODEL` en `src/lib/gemini.ts` (default `gemini-3.6-flash`) |
| Volumen de los sonidos       | `SOUND_VOLUME` en `src/lib/sounds.ts`                        |
