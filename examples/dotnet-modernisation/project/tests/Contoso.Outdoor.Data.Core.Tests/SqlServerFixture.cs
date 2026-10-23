using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Testcontainers.MsSql;

namespace Contoso.Outdoor.Data.Core.Tests;

/// <summary>
/// SQL Server in a container, created from Sql/schema.sql: the production schema as EF6 created it, plus seed rows.
/// The tests never reference the EF6 project; see .crewbie/team/data-access/cold/parity-tests.md.
/// </summary>
public sealed class SqlServerFixture : IAsyncLifetime
{
    private readonly MsSqlContainer container = new MsSqlBuilder().WithImage("mcr.microsoft.com/mssql/server:2022-latest").Build();

    public async ValueTask InitializeAsync()
    {
        await container.StartAsync();
        await using var connection = new SqlConnection(container.GetConnectionString());
        await connection.OpenAsync();
        foreach (var batch in File.ReadAllText("Sql/schema.sql").Split("\nGO", StringSplitOptions.RemoveEmptyEntries))
        {
            await using var command = new SqlCommand(batch, connection);
            await command.ExecuteNonQueryAsync();
        }
    }

    public OutdoorDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<OutdoorDbContext>().UseSqlServer(container.GetConnectionString()).Options);

    public string ConnectionString => container.GetConnectionString();

    public ValueTask DisposeAsync() => container.DisposeAsync();
}