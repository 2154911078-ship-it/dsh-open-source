/**
 * dsh-at-file — public type surface.
 *
 * Host half: serves GET /dsh-at-file/list for the composer @-picker and
 * expands `@token` file mentions in user messages at agent/pre-step.
 * Client half (./client): the `@`-triggered workspace file picker popup in
 * the conversation.input.overlay slot.
 */
export declare const name = "at-file";
export declare const inject: string[];
export declare function apply(ctx: any): void;
