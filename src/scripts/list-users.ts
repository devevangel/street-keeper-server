/**
 * List all users in the database
 * 
 * Usage: npx tsx src/scripts/list-users.ts
 * 
 * Prints all users with their IDs for use in API calls.
 */

import "dotenv/config";
import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (users.length === 0) {
      console.log("❌ No users found in database.");
      console.log("💡 Create one with: npx tsx src/scripts/create-test-user.ts");
      return;
    }

    console.log(`\n✅ Found ${users.length} user(s):\n`);
    
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.name}`);
      console.log(`   ID: ${user.id}`);
      if (user.email) {
        console.log(`   Email: ${user.email}`);
      }
      console.log(`   Created: ${user.createdAt.toISOString()}`);
      console.log();
    });

    console.log("📝 Use any userId in your API calls:");
    console.log(`   ?userId=${users[0].id}`);
    console.log("\n💡 Example curl command:");
    console.log(
      `   curl -X POST "http://localhost:3000/api/v1/engine-v2/analyze?userId=${users[0].id}" \\`
    );
    console.log(`     -F "gpxFile=@your-file.gpx"`);
    console.log();
  } catch (error) {
    console.error("❌ Error listing users:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
