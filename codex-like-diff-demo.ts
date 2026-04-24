type User = {
  id: number;
  name: string;
  role: "admin" | "member";
};

function formatUser(user: User): string {
  const badge = user.role === "admin" ? "★" : "•";
  const label = `${badge} ${user.name.toUpperCase()} (#${user.id})`;
  return `${label} — role: ${user.role}`;
}

const demoUser: User = {
  id: 42,
  name: "Dani",
  role: "admin",
};

const fallbackUser: User = {
  id: 7,
  name: "Guest",
  role: "member",
};

console.log(formatUser(demoUser));
