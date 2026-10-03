export interface LLMRequest {
  system: string;
  prompt: string;
  jsonSchema: object;
  temperature?: number;
}

export interface LLMResponse<T> {
  data: T;
  raw: string;
}

export interface LLMProvider {
  name: string;
  generateStructured<T>(req: LLMRequest): Promise<LLMResponse<T>>;
}

export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class ParseError extends Error {
  constructor(message: string, public raw: string) {
    super(message);
    this.name = 'ParseError';
  }
}
