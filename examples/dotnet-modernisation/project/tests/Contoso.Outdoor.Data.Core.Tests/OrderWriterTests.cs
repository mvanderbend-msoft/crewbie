using Contoso.Outdoor.Domain;
using Microsoft.Data.SqlClient;

namespace Contoso.Outdoor.Data.Core.Tests;

public sealed class OrderWriterTests(SqlServerFixture sql) : IClassFixture<SqlServerFixture>
{
    [Fact]
    public async Task Pending_order_is_written_in_the_shape_the_legacy_app_reads()
    {
        await using var db = sql.CreateContext();
        var address = new Address { Name = "Test Shopper", Street = "1 Test Lane", PostalCode = "0000 AA", City = "Testville" };
        var order = await new OrderWriter(db, new CartPricing(db)).PlaceAsync(new Cart().Add(3, 1), address, "shopper@example.test");

        await using var connection = new SqlConnection(sql.ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand(
            "SELECT o.Status, o.Total, o.DeliveryAddress_City, l.UnitPrice FROM dbo.Orders o JOIN dbo.OrderLines l ON l.Order_Id = o.Id WHERE o.Id = @id", connection);
        command.Parameters.AddWithValue("@id", order.Id);
        await using var row = await command.ExecuteReaderAsync();
        Assert.True(await row.ReadAsync());
        Assert.Equal((int)OrderStatus.PendingPayment, row.GetInt32(0));
        Assert.Equal(12.11m, row.GetDecimal(1));
        Assert.Equal("Testville", row.GetString(2));
        Assert.Equal(10.0050m, row.GetDecimal(3));
    }
}