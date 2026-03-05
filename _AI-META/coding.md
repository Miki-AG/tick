# Coding


## General
- Keep components simple. Split large functions. Move growing logic to helpers or services.
- Components render. Services handle logic
- Be explicit about state. Make impossible states impossible.
- Use types everywhere. Avoid 'any'.
- Don’t write code unless asked. Answer questions directly, no extra code.
- No silent fallbacks in the code. Fail loudly with clear console messages.
- When working in multiple phases or steps, always look back when startgin a new phase and optimize for a clean model redesign, avoid optimize for minimum code delta against the existing flow.

## Workflow (repeatable)
1. **Define API + signatures first**
   - Types/interfaces, function signatures, inputs/outputs, events.
2. **Write tests next**
   - Happy path + one failure path.
3. **Implement logic last**
   - Keep it boring. Small functions. Predictable state changes.
   



