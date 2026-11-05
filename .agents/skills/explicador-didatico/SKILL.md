---
name: explicador-didatico
description: >-
  Standardizes didactic code formatting, structured initial contracts, visual logical
  block boundaries, and conceptual 'why' comments. Supports multilingual codebases
  (PT-BR, EN) and adapts dynamically to the user's conversational language.
---

# Didactic Code Explainer (`explicador-didatico`)

This skill guides the model to transform raw, monolithic, or opaque source code into structured, highly readable, and self-explanatory educational code. It is designed for tutorials, documentation, technical onboarding, and pedagogical code reviews.

---

## 1. Dynamic Language Resolution (Rule of Precedence)

The structural formatting of this skill is language-agnostic, but the **content of contracts and comments** must strictly match the correct spoken language using the following priority order:

1. **Explicit Request**: If the user asks for a specific language (e.g., *"comment in Portuguese"* or *"write comments in English"*), adhere strictly to it.
2. **Conversational Context (Default)**: Generate all contracts, section names, and didactic notes in the **language the user is conversing with you in**.
   - If the user interacts in **Portuguese** ➔ Contracts and comments MUST be in **Portuguese** (e.g., `FUNÇÃO:`, `Nota didática:`).
   - If the user interacts in **English** ➔ Contracts and comments MUST be in **English** (e.g., `FUNCTION:`, `Didactic note:`).
3. **Existing Codebase Language**: In neutral or unstated contexts, analyze adjacent comments in the file and preserve the prevailing language of the repository.

---

## 2. Fundamental Architectural Pillars

### Pillar 1: Initial Structured Contract
Every non-trivial function, method, class, or module must begin with an explicit contract block delimited by double lines (`// =====` or `# =====`), detailing:
- **IDENTIFIER / TYPE**: Entity name and pedagogical role.
- **Objective**: The conceptual problem being solved (avoiding trivial syntax rewording).
- **Inputs / Parameters**: Names, expected types, and constraints of each argument.
- **Returns**: Types and semantic meaning of returned values across branches.
- **Complexity / Preconditions** (optional): Asymptotic complexity ($O(n)$) or required invariants.

### Pillar 2: Visual Logical Block Boundaries
- Partition internal execution flow into numbered, clearly named phases (e.g., Validation, Transformation, Processing, Fallback).
- Use clean, distinct separator lines (e.g., `// ---------------------------------------------------------------`).
- Maintain consistent vertical whitespace (1 blank line before and after boundary blocks).

### Pillar 3: Conceptual "Why" Comments & Didactic Notes
- **Eliminate Tautologies**: Never restate the obvious (e.g., avoid `i++ // increments i` or `return true // returns true`).
- **Explain the "Why"**: Detail business rationale, runtime behavior, operator idiosyncrasies (e.g., strict equality `===`, nullish coalescing `??`), edge cases, and algorithmic trade-offs.
- **Didactic Callouts**: Use explicit pedagogical markers:
  - English: `// Didactic note:`
  - Portuguese: `// Nota didática:`

---

## 3. Reference Implementations (Few-Shot Examples)

### Scenario A: English Context (Conversation or Request in English)

#### Raw Input:
```javascript
function checkAge(user) {
  if(user.age >= 18) {
    return true;
  }
  return false;
}
```

#### Canonical Output (English):
```javascript
// =================================================================
// FUNCTION: Pedagogical Age Verification
// Objective: Demonstrate conditional branch handling (if/else)
// Input: 'user' object containing numeric 'age' property
// Returns: Boolean (true for permitted, false for restricted)
// =================================================================

function checkAge(user) {
  
  // ---------------------------------------------------------------
  // 1. BUSINESS RULE VALIDATION
  // ---------------------------------------------------------------
  // We evaluate age against the legal adulthood constant (18).
  // Didactic note: The '>=' operator includes 18 in the boundary check.
  if (user.age >= 18) {
    return true; // Immediately returns and halts execution if condition is satisfied
  }
  
  // ---------------------------------------------------------------
  // 2. FALLBACK RETURN FLOW
  // ---------------------------------------------------------------
  // If execution reaches this point, the initial 'if' evaluated to false.
  // Therefore, the user is underage.
  return false;
}
```

---

### Scenario B: Portuguese Context (Conversation or Request in Portuguese)

#### Entrada Bruta:
```javascript
function checkAge(user) {
  if(user.age >= 18) {
    return true;
  }
  return false;
}
```

#### Saída Canônica (Português):
```javascript
// =================================================================
// FUNÇÃO: Verificação de Maioridade Pedagógica
// Objetivo: Demonstrar o uso de estruturas condicionais (if/else)
// Entrada: Objeto 'user' contendo a propriedade numérica 'age'
// Retorno: Booleano (true para liberado, false para bloqueado)
// =================================================================

function checkAge(user) {
  
  // ---------------------------------------------------------------
  // 1. VALIDAÇÃO DA REGRA DE NEGÓCIO
  // ---------------------------------------------------------------
  // Verificamos a idade comparando com a constante de maioridade (18).
  // Nota didática: O operador `>=` inclui o número 18 na validação.
  if (user.age >= 18) {
    return true; // Retorna imediatamente e interrompe a execução se for verdadeiro
  }
  
  // ---------------------------------------------------------------
  // 2. FLUXO DE RETORNO PADRÃO (FALLBACK)
  // ---------------------------------------------------------------
  // Se o programa chegou até aqui, significa que a condição do 'if' falhou.
  // Portanto, o usuário é menor de idade.
  return false;
}
```

---

## 4. Multi-Language Syntax Adaptations

Maintain syntax consistency with the host programming language while keeping the visual semantics:

- **JavaScript / TypeScript / C / C++ / C# / Java / Go / Rust / PHP / Swift**:
  - Contract Header: `// =================================================================`
  - Section Boundary: `// ---------------------------------------------------------------`
- **Python / Shell / Ruby**:
  - Contract Header: `# =================================================================`
  - Section Boundary: `# ---------------------------------------------------------------`
- **SQL**:
  - Contract Header: `-- =================================================================`
  - Section Boundary: `-- ---------------------------------------------------------------`
- **HTML / XML**:
  - Contract Header: `<!-- ============================================================= -->`
  - Section Boundary: `<!-- ----------------------------------------------------------- -->`

---

## 5. Verification Checklist

Before outputting formatted code:
1. [ ] Is the comment language matching the user's conversational language (or explicit override)?
2. [ ] Does the routine begin with a complete, structured initial contract header?
3. [ ] Are logical phases numbered and demarcated with clean separator lines?
4. [ ] Are comments focused on "why" (business rules, language mechanics, edge cases) rather than syntax restatements?
5. [ ] Is there at least one didactic callout highlighting key behavioral subtleties?
