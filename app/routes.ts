import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  layout("routes/layout.app.tsx", [
    index("routes/home.tsx"),
    route("animals", "routes/animals._index.tsx"),
    route("animals/:id", "routes/animals.$id.tsx"),
    route("admin/animals", "routes/admin.animals._index.tsx"),
    route("admin/animals/new", "routes/admin.animals.new.tsx"),
  ]),
  // Serves local-driver uploads; must stay outside the layout.
  route("files/*", "routes/files.$.ts"),
] satisfies RouteConfig;
