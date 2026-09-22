if (typeof process !== "undefined" && typeof (process as any).getBuiltinModule === "function") {
  const orig = (process as any).getBuiltinModule;
  Object.defineProperty(process, "getBuiltinModule", {
    value: function (id: string) {
      if (id === "v8") {
        return {
          startupSnapshot: {
            isBuildingSnapshot: () => false,
          },
        };
      }
      return orig.call(process, id);
    },
    writable: true,
    configurable: true,
  });
}
