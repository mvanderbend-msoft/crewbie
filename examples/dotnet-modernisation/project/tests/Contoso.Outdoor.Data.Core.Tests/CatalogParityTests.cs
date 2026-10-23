using System.Text.Json;
using Contoso.Outdoor.Domain;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Contoso.Outdoor.Data.Core.Tests;

public sealed class CatalogParityTests(SqlServerFixture sql) : IClassFixture<SqlServerFixture>
{
    private static readonly JsonElement Legacy = JsonDocument.Parse(File.ReadAllText("Recorded/legacy-catalog.json")).RootElement;

    [Fact]
    public async Task Every_mapped_column_matches_the_schema()
    {
        await using var db = sql.CreateContext();
        await using var connection = new SqlConnection(sql.ConnectionString);
        await connection.OpenAsync();
        foreach (var entity in db.Model.GetEntityTypes().Where(e => e.GetTableName() is not null))
        {
            foreach (var property in entity.GetProperties())
            {
                var column = property.GetColumnName();
                await using var command = new SqlCommand(
                    "SELECT DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table AND COLUMN_NAME = @column", connection);
                command.Parameters.AddWithValue("@table", entity.GetTableName());
                command.Parameters.AddWithValue("@column", column);
                await using var row = await command.ExecuteReaderAsync();
                Assert.True(await row.ReadAsync(), $"{entity.GetTableName()}.{column} does not exist");
                if (row.GetString(0) == "decimal")
                {
                    Assert.Equal($"decimal({row.GetByte(1)},{row.GetInt32(2)})", property.GetColumnType());
                }
            }
        }
    }

    [Fact]
    public async Task Category_page_matches_the_legacy_result()
    {
        await using var db = sql.CreateContext();
        var page = await new CatalogQueries(db).PageAsync("tents", 1);
        var expected = Legacy.GetProperty("tentsPage1").EnumerateArray().Select(p => (p.GetProperty("slug").GetString(), p.GetProperty("price").GetDecimal()));
        Assert.Equal(expected, page.Select(p => ((string?)p.Slug, p.Price)));
    }

    [Fact]
    public async Task Cart_pricing_matches_the_legacy_total_and_skips_deleted_products()
    {
        await using var db = sql.CreateContext();
        var lines = await new CartPricing(db).PriceAsync(new Cart().Add(3, 1).Add(999, 2));
        Assert.Single(lines);
        Assert.Equal(Legacy.GetProperty("cartTotalCampStove").GetDecimal(), CartPricing.Total(lines));
    }
}