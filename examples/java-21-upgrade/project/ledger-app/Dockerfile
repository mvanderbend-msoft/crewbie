FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/ledger-app.jar /app/ledger-app.jar
COPY target/lib /app/lib
EXPOSE 8080
USER 10001
ENTRYPOINT ["java", "-jar", "/app/ledger-app.jar"]
