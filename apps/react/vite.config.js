import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { transformSync } from "@babel/core";
import path from "node:path";

export default defineConfig(({ command }) => ({
  plugins: [talkableSourceMetadataPlugin(command), react()]
}));

function talkableSourceMetadataPlugin(command) {
  const enabled =
    command === "serve" || process.env.TALKABLE_INSTRUMENT_REACT === "1";

  return {
    name: "talkable-source-metadata",
    enforce: "pre",
    transform(code, id) {
      if (
        !enabled ||
        id.includes("node_modules") ||
        !/\.[jt]sx$/.test(id)
      ) {
        return null;
      }

      const relativeFile = path.relative(process.cwd(), id);
      const result = transformSync(code, {
        filename: id,
        parserOpts: {
          plugins: ["jsx"]
        },
        plugins: [createTalkableBabelPlugin(relativeFile)],
        sourceMaps: true
      });

      if (!result?.code) {
        return null;
      }

      return {
        code: result.code,
        map: result.map
      };
    }
  };
}

function createTalkableBabelPlugin(relativeFile) {
  return ({ types: t }) => ({
    visitor: {
      FunctionDeclaration: {
        enter(path, state) {
          const name = path.node.id?.name;
          pushComponent(state, isComponentName(name) ? name : undefined);
        },
        exit(path, state) {
          popComponent(state);
        }
      },
      FunctionExpression: {
        enter(path, state) {
          pushComponent(state, getFunctionComponentName(path));
        },
        exit(path, state) {
          popComponent(state);
        }
      },
      ArrowFunctionExpression: {
        enter(path, state) {
          pushComponent(state, getFunctionComponentName(path));
        },
        exit(path, state) {
          popComponent(state);
        }
      },
      JSXOpeningElement(path, state) {
        const name = path.node.name;

        if (!t.isJSXIdentifier(name) || !isDomTag(name.name)) {
          return;
        }

        if (hasAttribute(path.node, "data-talkable-source-file")) {
          return;
        }

        const location = path.node.loc?.start;
        const component = currentComponent(state);

        path.node.attributes.push(
          jsxAttribute(t, "data-talkable-source-file", relativeFile),
          jsxAttribute(t, "data-talkable-source-line", String(location?.line ?? "")),
          jsxAttribute(
            t,
            "data-talkable-source-column",
            String((location?.column ?? 0) + 1)
          )
        );

        if (component) {
          path.node.attributes.push(
            jsxAttribute(t, "data-talkable-source-component", component)
          );
        }
      }
    }
  });
}

function getFunctionComponentName(path) {
  const parent = path.parentPath;

  if (parent?.isVariableDeclarator()) {
    const name = parent.node.id?.name;
    return isComponentName(name) ? name : undefined;
  }

  if (parent?.isAssignmentExpression()) {
    const name = parent.node.left?.name;
    return isComponentName(name) ? name : undefined;
  }

  return undefined;
}

function pushComponent(state, component) {
  state.talkableComponentStack = state.talkableComponentStack || [];
  state.talkableComponentStack.push(component);
}

function popComponent(state) {
  state.talkableComponentStack?.pop();
}

function currentComponent(state) {
  return [...(state.talkableComponentStack || [])]
    .reverse()
    .find(Boolean);
}

function isComponentName(name) {
  return typeof name === "string" && /^[A-Z]/.test(name);
}

function isDomTag(name) {
  return /^[a-z]/.test(name);
}

function hasAttribute(node, attributeName) {
  return node.attributes.some(
    (attribute) => attribute.name?.name === attributeName
  );
}

function jsxAttribute(t, name, value) {
  return t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value));
}
