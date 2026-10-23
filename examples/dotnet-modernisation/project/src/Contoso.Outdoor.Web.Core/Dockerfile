FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Contoso.Outdoor.Domain/ Contoso.Outdoor.Domain/
COPY src/Contoso.Outdoor.Data.Core/ Contoso.Outdoor.Data.Core/
COPY src/Contoso.Outdoor.Web.Core/ Contoso.Outdoor.Web.Core/
RUN dotnet publish Contoso.Outdoor.Web.Core -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Contoso.Outdoor.Web.Core.dll"]