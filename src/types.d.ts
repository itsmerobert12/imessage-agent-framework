declare module 'better-sqlite3' {
  namespace BetterSqlite3 {
    interface Database {
      pragma(pragma: string): any;
      exec(sql: string): void;
      prepare(sql: string): Statement;
      close(): void;
      readonly name: string;
    }
    interface Statement {
      run(...params: any[]): any;
      get(...params: any[]): any;
      all(...params: any[]): any[];
    }
    interface Options {
      readonly?: boolean;
      fileMustExist?: boolean;
    }
  }
  class BetterSqlite3 {
    constructor(filename: string, options?: BetterSqlite3.Options);
    pragma(pragma: string): any;
    exec(sql: string): void;
    prepare(sql: string): BetterSqlite3.Statement;
    close(): void;
    readonly name: string;
  }
  export = BetterSqlite3;
}
