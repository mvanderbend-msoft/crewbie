---
applyTo: "**/pom.xml"
---
# Maven build

- Compile with `<maven.compiler.release>`, not `source`/`target`; `release` also checks API use against the target JDK.
- Java 21 needs at least Lombok 1.18.30, Mockito 5 (Byte Buddy 1.14), JaCoCo 0.8.11 and Surefire 3; older versions fail on class file version 65.
- Upgrade one blocking library per commit so a failing test points to its cause.
