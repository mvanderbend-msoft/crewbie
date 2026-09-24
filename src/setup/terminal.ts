import { confirm, input, select } from "@inquirer/prompts";

export interface MenuChoice { value: string; name: string; description: string }
export interface SetupPrompts {
  ask: (message: string) => Promise<string>;
  select: (message: string, choices: MenuChoice[], defaultValue: string) => Promise<string>;
  confirm: (message: string, defaultValue: boolean) => Promise<boolean>;
}

export function terminalPrompts(context?: Parameters<typeof input>[1]): SetupPrompts {
  return {
    ask: (message) => input({ message }, context),
    select: (message, choices, defaultValue) => select({
      message, choices, default: defaultValue, pageSize: 8, loop: false,
    }, context),
    confirm: (message, defaultValue) => confirm({ message, default: defaultValue }, context),
  };
}
