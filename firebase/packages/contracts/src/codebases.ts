export const archiveFunctionCodebases = {
  "functions-alimtalk": {
    area: "alimtalk",
    deployTarget: "functions:functions-alimtalk",
    source: "firebase/function-codebases/alimtalk",
    ownsMemberFacingSend: true,
  },
  "functions-private-chart": {
    area: "private-chart",
    deployTarget: "functions:functions-private-chart",
    source: "firebase/function-codebases/private-chart",
    ownsMemberFacingSend: true,
  },
  "functions-sync": {
    area: "sync",
    deployTarget: "functions:functions-sync",
    source: "firebase/function-codebases/sync",
    ownsMemberFacingSend: false,
  },
  "functions-app": {
    area: "app",
    deployTarget: "functions:functions-app",
    source: "firebase/function-codebases/app",
    ownsMemberFacingSend: false,
  },
  "functions-social": {
    area: "social",
    deployTarget: "functions:functions-social",
    source: "firebase/function-codebases/social",
    ownsMemberFacingSend: true,
  },
} as const;

export type ArchiveFunctionCodebase = keyof typeof archiveFunctionCodebases;

export const archiveFunctionCodebaseNames = Object.keys(archiveFunctionCodebases) as ArchiveFunctionCodebase[];

export function isArchiveFunctionCodebase(value: string): value is ArchiveFunctionCodebase {
  return value in archiveFunctionCodebases;
}
