/**
 * Shared XML-based tool call parser for all agent interfaces.
 * Tools are invoked via <invoke name="tool_name"><parameter name="param">value</parameter></invoke>
 */

export interface ToolCall {
  name: string;
  args: Record<string, string>;
  result?: string;
}

/**
 * Parse tool calls from an LLM response using XML invoke format.
 * Supports complete calls and recovers truncated calls (LLM ran out of tokens mid-call).
 */
export function parseToolCalls(response: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Try complete tool calls first
  const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
  let match;
  while ((match = invokeRegex.exec(response)) !== null) {
    const name = match[1];
    const body = match[2];
    const args: Record<string, string> = {};
    const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }
    calls.push({ name, args });
  }

  // If no complete calls found, try to recover truncated tool calls
  // (LLM ran out of tokens mid-call)
  if (calls.length === 0 && response.includes("<invoke")) {
    const truncatedInvoke = /<invoke\s+name="([^"]+)">([\s\S]*)$/;
    const truncMatch = response.match(truncatedInvoke);
    if (truncMatch) {
      const name = truncMatch[1];
      const body = truncMatch[2];
      const args: Record<string, string> = {};

      // Try complete parameters first
      const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(body)) !== null) {
        args[paramMatch[1]] = paramMatch[2].trim();
      }

      // Try to recover the last truncated parameter (no closing tag)
      const truncParam = /<parameter\s+name="([^"]+)">([\s\S]+)$/;
      const truncParamMatch = body.replace(/<parameter\s+name="[^"]+">[^]*?<\/parameter>/g, "").match(truncParam);
      if (truncParamMatch && !args[truncParamMatch[1]]) {
        args[truncParamMatch[1]] = truncParamMatch[2].trim();
      }

      if (Object.keys(args).length > 0) {
        calls.push({ name, args });
      }
    }
  }

  return calls;
}

/**
 * Strip tool call XML from a response, leaving only the human-readable text.
 */
export function stripToolCallXml(response: string): string {
  return response
    .replace(/<invoke\s+name="[^"]*">[\s\S]*?<\/invoke>/g, "")
    .replace(/<invoke\s+name="[^"]*">[\s\S]*$/g, "") // truncated
    .trim();
}
